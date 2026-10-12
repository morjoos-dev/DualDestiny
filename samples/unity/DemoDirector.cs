using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using Mirror;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.Rendering;
using Debug = UnityEngine.Debug;

/// <summary>
/// Director de vídeos (solo con <c>-guion archivo.txt</c> en la línea de comandos; para los jugadores no existe).
/// El cliente sigue un guion (teclas simuladas, comandos del chat) y se graba a sí mismo desde la cámara del juego,
/// enviando los fotogramas a ffmpeg: sin interfaz, sin barra de ventana y sin usar el teclado ni el ratón del PC,
/// así que puede ir en segundo plano. Órdenes del guion (una por línea, # = comentario):
///   wait S                  esperar S segundos
///   chat /texto             envía un mensaje o comando del chat
///   down TECLA[+TECLA]      mantiene pulsadas (nombres de UnityEngine.InputSystem.Key: D, LeftCtrl, E, Digit2…)
///   up TECLA[+TECLA]        las suelta
///   tap TECLA               pulsa y suelta
///   spam TECLA S [cada]     pulsa y suelta durante S segundos (por defecto cada 0,2 s), p. ej. el ataque básico
///   zoom N                  píxeles de pantalla por píxel del juego (entero: nítido). Por defecto 6
///   skill ID                lanza una habilidad por su id (sin depender de la tecla de la barra)
///   morph NPCID|off         Metamorfo: toma esa forma (lo mismo que elegirla en el bestiario)
///   limpio on|off           oculta nombres de enemigos, etiquetas del botín y «Esquiva» (los números de daño se quedan)
///   cam DX DY               desplaza el encuadre respecto al jugador (casillas)
///   rec NOMBRE              empieza a grabar NOMBRE.mp4 en la carpeta de -grabarEn
///   stop                    termina la grabación
///   quit                    cierra el juego
/// Otros argumentos: -grabarEn CARPETA, -ffmpeg RUTA, -grabarTam 1920x1080.
/// </summary>
public class DemoDirector : MonoBehaviour
{
    string scriptPath, outDir, ffmpegPath;
    int W = 1920, H = 1080, zoom = 6;
    Vector2 camOff, camPos; bool camInit, clean;
    float nextClean;
    readonly HashSet<Key> held = new();
    Camera capCam;
    RenderTexture rt;
    Process ff;
    Stream ffIn;
    readonly Queue<byte[]> pending = new();
    System.Threading.Thread writer;
    volatile bool recording;
    readonly object qlock = new();

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void AutoCreate()
    {
        if (Application.isBatchMode || Arg("-guion") == null) return;
        var go = new GameObject("[DemoDirector]");
        DontDestroyOnLoad(go);
        go.AddComponent<DemoDirector>();
    }

    static string Arg(string name)
    {
        var a = Environment.GetCommandLineArgs();
        for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
        return null;
    }

    void Start()
    {
        scriptPath = Arg("-guion");
        outDir = Arg("-grabarEn") ?? Path.GetDirectoryName(scriptPath);
        ffmpegPath = Arg("-ffmpeg") ?? "ffmpeg";
        var tam = Arg("-grabarTam");
        if (tam != null) { var p = tam.Split('x'); W = int.Parse(p[0]); H = int.Parse(p[1]); }
        // Seguir funcionando sin el foco: el juego va en segundo plano mientras se graba
        Application.runInBackground = true;
        InputSystem.settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
        StartCoroutine(Run());
    }

    static NetworkPlayer Local() => NetworkClient.localPlayer != null ? NetworkClient.localPlayer.GetComponent<NetworkPlayer>() : null;

    IEnumerator Run()
    {
        Debug.Log("[Demo] Esperando al jugador…");
        while (Local() == null) yield return null;
        yield return new WaitForSeconds(2f);
        var lines = File.ReadAllLines(scriptPath);
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            int sp = line.IndexOf(' ');
            string cmd = (sp < 0 ? line : line.Substring(0, sp)).ToLowerInvariant(), rest = sp < 0 ? "" : line.Substring(sp + 1).Trim();
            { var me = Local(); Debug.Log($"[Demo] {line}   (muerto={(me != null && me.IsDead)} pos={(me != null ? me.transform.position : Vector3.zero)})"); }
            switch (cmd)
            {
                case "wait": yield return new WaitForSeconds(F(rest)); break;
                case "chat": Local()?.CmdChat(rest); yield return new WaitForSeconds(0.6f); break;   // el chat del servidor ignora mensajes a menos de 0,4 s
                case "down": foreach (var k in Keys(rest)) held.Add(k); Push(); break;
                case "up": foreach (var k in Keys(rest)) held.Remove(k); Push(); break;
                case "tap": yield return Tap(Keys(rest)); break;
                case "spam":
                {
                    var p = rest.Split(' ');
                    float dur = F(p[1]), every = p.Length > 2 ? F(p[2]) : 0.2f, end = Time.time + dur;
                    var ks = Keys(p[0]);
                    while (Time.time < end) { yield return Tap(ks); yield return new WaitForSeconds(Mathf.Max(0f, every - 0.05f)); }
                    break;
                }
                case "skill": { bool ok = Local()?.GetComponent<SkillManager>()?.TryUseSkill(rest.Trim()) ?? false; Debug.Log("[Demo] habilidad " + rest + (ok ? " lanzada" : " NO lanzada")); yield return null; break; }
                case "morph": Local()?.CmdMorph(rest.Trim() == "off" ? "" : rest.Trim(), ""); yield return null; break;
                case "limpio": clean = rest.Trim().ToLowerInvariant() != "off"; break;
                case "zoom": zoom = Mathf.Max(1, int.Parse(rest)); break;
                case "cam": { var p = rest.Split(' '); camOff = new Vector2(F(p[0]), F(p[1])); break; }
                case "rec": StartRec(rest); break;
                case "stop": StopRec(); break;
                case "quit": StopRec(); Application.Quit(); yield break;
                default: Debug.LogWarning("[Demo] Orden desconocida: " + line); break;
            }
        }
        StopRec();
        Debug.Log("[Demo] Guion terminado");
    }

    IEnumerator Tap(List<Key> ks)
    {
        foreach (var k in ks) held.Add(k);
        Push();
        yield return null; yield return null;
        foreach (var k in ks) held.Remove(k);
        Push();
        yield return null;
    }

    void Push()
    {
        if (Keyboard.current == null) return;
        var keys = new Key[held.Count]; held.CopyTo(keys);
        InputSystem.QueueStateEvent(Keyboard.current, new KeyboardState(keys));
    }

    static List<Key> Keys(string s)
    {
        var list = new List<Key>();
        foreach (var n in s.Split('+'))
            if (Enum.TryParse(n.Trim(), true, out Key k)) list.Add(k); else Debug.LogWarning("[Demo] Tecla desconocida: " + n);
        return list;
    }

    static float F(string s) => float.Parse(s.Trim().Replace(',', '.'), CultureInfo.InvariantCulture);

    // ── Grabación ───────────────────────────────────────────────────────────────────────────────

    void StartRec(string name)
    {
        StopRec();
        Directory.CreateDirectory(outDir);
        string file = Path.Combine(outDir, name + ".mp4");
        var psi = new ProcessStartInfo(ffmpegPath,
            $"-y -loglevel error -f rawvideo -pix_fmt rgba -s {W}x{H} -r 30 -i - -vf vflip -c:v libx264 -preset veryfast -crf 17 -pix_fmt yuv420p \"{file}\"")
        { UseShellExecute = false, RedirectStandardInput = true, CreateNoWindow = true };
        ff = Process.Start(psi);
        ffIn = ff.StandardInput.BaseStream;
        rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32) { filterMode = FilterMode.Point };
        if (capCam == null)
        {
            capCam = new GameObject("[DemoCam]").AddComponent<Camera>();
            DontDestroyOnLoad(capCam.gameObject);
            capCam.enabled = false;
        }
        Application.targetFrameRate = 30;
        QualitySettings.vSyncCount = 0;
        recording = true;
        writer = new System.Threading.Thread(WriteLoop) { IsBackground = true };
        writer.Start();
        StartCoroutine(CaptureLoop());
        Debug.Log("[Demo] Grabando " + file);
    }

    IEnumerator CaptureLoop()
    {
        var eof = new WaitForEndOfFrame();
        float next = Time.unscaledTime;
        while (recording)
        {
            yield return eof;
            if (!recording) break;
            if (Time.unscaledTime < next) continue;
            next += 1f / 30f;
            if (Time.unscaledTime - next > 0.2f) next = Time.unscaledTime;   // si se atrasa, no acumula
            var main = Camera.main;
            if (main == null) continue;
            capCam.CopyFrom(main);
            capCam.enabled = false;
            capCam.orthographic = true;
            // Encuadre centrado en el jugador (con un seguimiento suave), no en la cámara del juego
            var me = Local();
            if (me != null)
            {
                Vector2 target = (Vector2)me.transform.position + camOff * GameScale.Tile;
                camPos = camInit ? Vector2.Lerp(camPos, target, 0.18f) : target; camInit = true;
                // ajustado a la rejilla de píxeles de pantalla: sin temblores ni difuminado
                float px = 1f / (16f * zoom);
                capCam.transform.position = new Vector3(Mathf.Round(camPos.x / px) * px, Mathf.Round(camPos.y / px) * px, main.transform.position.z);
            }
            // Zoom entero: cada píxel del juego (16 por casilla) ocupa zoom×zoom píxeles → nítido, sin difuminar
            capCam.orthographicSize = H / (2f * 16f * zoom);
            capCam.targetTexture = rt;
            var req = new RenderPipeline.StandardRequest { destination = rt };
            if (RenderPipeline.SupportsRenderRequest(capCam, req)) RenderPipeline.SubmitRenderRequest(capCam, req);
            else capCam.Render();
            capCam.targetTexture = null;
            AsyncGPUReadback.Request(rt, 0, TextureFormat.RGBA32, r =>
            {
                if (r.hasError || !recording) return;
                var bytes = r.GetData<byte>().ToArray();
                lock (qlock) { pending.Enqueue(bytes); System.Threading.Monitor.Pulse(qlock); }
            });
        }
    }

    void WriteLoop()
    {
        while (true)
        {
            byte[] frame = null;
            lock (qlock)
            {
                while (pending.Count == 0 && recording) System.Threading.Monitor.Wait(qlock, 200);
                if (pending.Count > 0) frame = pending.Dequeue();
                else if (!recording) return;
            }
            if (frame != null) try { ffIn.Write(frame, 0, frame.Length); } catch (Exception e) { Debug.LogWarning("[Demo] ffmpeg: " + e.Message); return; }
        }
    }

    void StopRec()
    {
        if (!recording) return;
        recording = false;
        AsyncGPUReadback.WaitAllRequests();
        lock (qlock) System.Threading.Monitor.PulseAll(qlock);
        writer?.Join(5000);
        try { ffIn.Flush(); ffIn.Close(); } catch { }
        ff?.WaitForExit(20000);
        ff = null;
        if (rt != null) { rt.Release(); Destroy(rt); rt = null; }
        Application.targetFrameRate = -1;
        Debug.Log("[Demo] Grabación terminada");
    }

    void Update()
    {
        if (!clean || Time.unscaledTime < nextClean) return;
        nextClean = Time.unscaledTime + 0.15f;
        foreach (var t in FindObjectsByType<TMPro.TMP_Text>(FindObjectsSortMode.None))
        {
            bool hide = t.gameObject.name == "NPCLabel" || t.GetComponentInParent<WorldItem>() != null || (t.text != null && t.text.Contains("Esquiva"));
            if (hide && t.enabled) t.enabled = false;
            // la placa de fondo de las etiquetas (TextStyle.FitPlate) va en un hijo
            if (hide) foreach (var r in t.GetComponentsInChildren<SpriteRenderer>()) r.enabled = false;
        }
        // el botín del suelo entero (icono y brillo): en el vídeo solo distrae
        foreach (var w in FindObjectsByType<WorldItem>(FindObjectsSortMode.None))
            foreach (var r in w.GetComponentsInChildren<Renderer>()) if (r.enabled) r.enabled = false;
    }

    void OnApplicationQuit() => StopRec();
}
