using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Mirror;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Rasgo Paso de sombra (rpg-server/rasgos/paso_sombra.json): el asesino móvil. Las «sombras» son lo que ya hay en el
/// mapa: árboles, rocas, muros y objetos (lo sólido que no es un personaje, y la colisión baja de «objetos").
///  · F/E: "Paso de sombra" (efecto shadow_step): teletransporte hacia donde mira, con cargas que se recargan solas; si
///    aparece pegado a una sombra, se oculta unos segundos (los enemigos le pierden de vista).
///  · D: el primer golpe tras el paso o desde oculto es una puñalada (×2 y crítico).
///  · C: "Uno con las sombras" (shadow_meld, activa): oculto hasta que ataca.
///  · B: sus golpes marcan al enemigo (aura de sombra) y le ralentizan.
///  · A: "Asalto de sombra" (shadow_assault, activa): deja un señuelo y aparece a la espalda del marcado más cercano con
///    un golpe crítico que consume la marca.   · S: Danza de sombras (shadow_dance): salta entre enemigos apuñalando, intocable.
/// </summary>
public partial class NetworkPlayer
{
    [SyncVar(hook = nameof(OnShadowHiddenChanged))] bool sv_shadowHidden;
    public bool ServerHiddenInShadow => sv_shadowHidden;
    public bool ServerShadowDancing => shadowDancing;

    /// <summary>Enemigos marcados (rango B): todos los clientes les dibujan el aura de sombra.</summary>
    public readonly SyncList<uint> shadowMarkIds = new SyncList<uint>();

    bool IsShadowTrait => ServerTraitId == "paso_sombra";
    int  ShadowMaxCharges => Mathf.Clamp(Mathf.RoundToInt(ServerTraitValue("cargas", 1f)), 1, 3);

    int     shadowCharges = -1;
    float   shadowChargeAt, shadowHiddenUntil, shadowStrikeUntil, shadowKillUntil;
    bool    shadowMeld, shadowDancing, shadowOwnStrike;   // shadowOwnStrike: golpe del asalto o la danza (no marca ni es puñalada)
    readonly Dictionary<NPCEnemy, float> shadowMarks = new();

    // ── Cargas ───────────────────────────────────────────────────────────────────────────

    [Server]
    void ShadowRefill()
    {
        int max = ShadowMaxCharges;
        if (shadowCharges < 0 || shadowCharges > max) { shadowCharges = max; shadowChargeAt = 0f; }
        float every = Mathf.Max(0.5f, ServerTraitValue("recarga", 6f));
        if (shadowCharges < max && shadowChargeAt <= 0f) shadowChargeAt = Time.time + every;
        while (shadowCharges < max && Time.time >= shadowChargeAt)
        {
            shadowCharges++;
            shadowChargeAt = shadowCharges < max ? shadowChargeAt + every : 0f;
        }
    }

    /// <summary>¿Puede lanzar esta habilidad de Paso de sombra? (si no, ni se paga ni gasta recarga)</summary>
    [Server]
    public bool ServerCanShadow(SkillData skill, out string why)
    {
        why = "";
        bool step = skill.HasEffect("shadow_step"), dance = skill.HasEffect("shadow_dance"),
             meld = skill.HasEffect("shadow_meld"), assault = skill.HasEffect("shadow_assault");
        if (!step && !dance && !meld && !assault) return true;
        if (!IsShadowTrait) { why = "Necesitas el Paso de sombra"; return false; }
        if (shadowDancing) { why = "Ya estás danzando"; return false; }
        if (step)
        {
            ShadowRefill();
            if (shadowCharges <= 0) { why = $"Sin cargas ({Mathf.CeilToInt(shadowChargeAt - Time.time)} s)"; return false; }
            return true;
        }
        if (meld)
        {
            if (ServerTraitValue("fundirse") < 1f) { why = "Necesitas el Paso de sombra en rango C"; return false; }
            if (sv_shadowHidden && shadowMeld) { why = "Ya eres uno con las sombras"; return false; }
            return true;
        }
        if (assault)
        {
            if (ServerTraitValue("asalto") < 1f) { why = "Necesitas el Paso de sombra en rango A"; return false; }
            if (NearestMark() == null) { why = "No hay enemigos marcados cerca"; return false; }
            return true;
        }
        if (ServerTraitValue("danza") < 1f) { why = "Necesitas el Paso de sombra en rango S"; return false; }
        float r = ServerTraitValue("danza_radio", 5f) * GameScale.Tile;
        if (SkillExecutor.EnemiesInCircle(transform.position, r, this).Count == 0) { why = "No hay enemigos cerca"; return false; }
        return true;
    }

    // ── Paso de sombra ───────────────────────────────────────────────────────────────────

    /// <summary>Efecto "shadow_step": teletransporte hacia dir; si aparece junto a una sombra, se oculta.</summary>
    [Server]
    public void ServerShadowStep(SkillEffect e, Vector2 dir)
    {
        ShadowRefill();
        if (shadowCharges <= 0) return;
        shadowCharges--;
        if (shadowChargeAt <= 0f) shadowChargeAt = Time.time + Mathf.Max(0.5f, ServerTraitValue("recarga", 6f));

        Vector2 from = transform.position;
        Vector2 feetOffset = SkillExecutor.FeetOf(this) - from;
        if (dir.sqrMagnitude < 0.01f) dir = DirFromFacing();
        dir.Normalize();
        float reach = ServerTraitValue("alcance", 4f) * GameScale.Tile;
        float dist  = Mathf.Max(0f, Mathf.Min(reach, SkillExecutor.WallDistance(from, dir, reach)) - 0.3f);
        Vector2 dest = from + dir * dist;
        // Sin volar no se cae al agua, la lava ni un abismo: se acorta hasta suelo firme
        if (!sv_flying) dest = FirmGround(from, dest);

        ServerPlayFx("parpadeo", from);
        ServerDashTo(dest);
        ServerPlayFx("parpadeo", dest);
        ServerTraitProgress("pasos", 1);

        if (ServerTraitValue("punalada") > 0f) shadowStrikeUntil = Time.time + ServerTraitValue("punalada_seg", 3f);
        if (NearShadow(dest + feetOffset))
        {
            shadowHiddenUntil = Time.time + ServerTraitValue("oculto", 2f);
            if (!shadowMeld) SetShadowHidden(true, meld: false);
            RpcStatusText("Oculto", new Color(0.7f, 0.6f, 1f));
        }
        PushVitals();
    }

    Vector2 DirFromFacing() => sv_direction switch { 1 => Vector2.up, 2 => Vector2.left, 3 => Vector2.right, _ => Vector2.down };

    // Del destino hacia atrás, a pasos de media casilla, hasta un punto sin colisión baja (agua, lava, abismo, objetos)
    Vector2 FirmGround(Vector2 from, Vector2 dest)
    {
        int water = LayerMask.NameToLayer("Water");
        if (water < 0) return dest;
        Vector2 back = from - dest;
        float len = back.magnitude;
        if (len < 0.01f) return dest;
        back /= len;
        for (float d = 0f; d <= len; d += 0.5f * GameScale.Tile)
        {
            Vector2 p = dest + back * d;
            if (Physics2D.OverlapCircle(p, 0.3f * GameScale.Tile, 1 << water) == null) return p;
        }
        return from;
    }

    /// <summary>¿Hay una sombra (árbol, roca, muro, objeto) pegada a estos pies?</summary>
    [Server]
    bool NearShadow(Vector2 feet)
    {
        float r = Mathf.Max(0.3f, ServerTraitValue("sombra_radio", 1f)) * GameScale.Tile;
        bool prev = Physics2D.queriesHitTriggers;
        Physics2D.queriesHitTriggers = false;
        var hits = Physics2D.OverlapCircleAll(feet, r);
        Physics2D.queriesHitTriggers = prev;
        int water = LayerMask.NameToLayer("Water");
        foreach (var h in hits)
        {
            if (h == null || h.isTrigger) continue;
            if (h.GetComponentInParent<NetworkPlayer>() != null || h.GetComponentInParent<NPCEnemy>() != null) continue;
            if (h.GetComponentInParent<NetworkProjectile>() != null) continue;
            if (h.gameObject.layer == water && !h.name.Contains("(objetos)")) continue;   // el agua y la lava no dan sombra
            return true;
        }
        return false;
    }

    [Server]
    void SetShadowHidden(bool on, bool meld)
    {
        shadowMeld = on && meld;
        if (!on) shadowHiddenUntil = 0f;
        if (sv_shadowHidden != on) sv_shadowHidden = on;
    }

    // ── Marcas (rango B) ─────────────────────────────────────────────────────────────────

    [Server]
    void ShadowMark(NPCEnemy target)
    {
        float secs = ServerTraitValue("marca_seg", 8f);
        shadowMarks[target] = Time.time + secs;
        float slow = ServerTraitValue("marca_lento", 30f);
        if (slow > 0f) target.ServerApplyControl("slow", slow, secs);
        if (!shadowMarkIds.Contains(target.netId)) shadowMarkIds.Add(target.netId);
    }

    [Server]
    void ShadowUnmark(NPCEnemy target)
    {
        if (target == null) return;
        shadowMarks.Remove(target);
        shadowMarkIds.Remove(target.netId);
    }

    // Quita las marcas caducadas o de enemigos muertos (y todas si clear)
    [Server]
    void ShadowPurgeMarks(bool clear = false)
    {
        if (shadowMarks.Count == 0 && shadowMarkIds.Count == 0) return;
        foreach (var t in shadowMarks.Keys.ToList())
            if (clear || t == null || t.IsDeadServer || Time.time >= shadowMarks[t]) shadowMarks.Remove(t);
        var keep = new HashSet<uint>(shadowMarks.Keys.Select(t => t.netId));
        for (int i = shadowMarkIds.Count - 1; i >= 0; i--)
            if (!keep.Contains(shadowMarkIds[i])) shadowMarkIds.RemoveAt(i);
    }

    // El marcado vivo más cercano a su alcance (Asalto de sombra), en su mapa y su fase
    [Server]
    NPCEnemy NearestMark()
    {
        ShadowPurgeMarks();
        float reach = ServerTraitValue("asalto_alcance", 8f) * GameScale.Tile;
        NPCEnemy best = null; float bestD = float.MaxValue;
        foreach (var t in shadowMarks.Keys)
        {
            if (t == null || t.gameObject.scene != gameObject.scene || !Phases.Same(gameObject, t.gameObject)) continue;
            float d = Vector2.Distance(transform.position, t.transform.position);
            if (d <= reach && d < bestD) { bestD = d; best = t; }
        }
        return best;
    }

    // ── Golpes ───────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Golpe de este jugador a un enemigo (NPCEnemy.TakeDamageFrom): atacar le descubre, marca y ralentiza al enemigo
    /// (rango B) y, si la puñalada está lista (rango D), devuelve su multiplicador (×2 y crítico).
    /// </summary>
    [Server]
    public float ServerShadowOnHit(NPCEnemy target)
    {
        if (!IsShadowTrait || shadowOwnStrike) return 1f;
        if (ServerTraitValue("marca") >= 1f && target != null && !target.IsDeadServer) ShadowMark(target);
        bool ready = ServerTraitValue("punalada") > 0f && (Time.time < shadowStrikeUntil || sv_shadowHidden);
        bool wasHidden = sv_shadowHidden;
        if (sv_shadowHidden) SetShadowHidden(false, false);
        if (!ready) return 1f;
        shadowStrikeUntil = 0f;
        shadowKillUntil = Time.time + 0.5f;
        ServerTraitProgress("punaladas", 1);
        RpcStatusText(wasHidden ? "¡Puñalada desde la sombra!" : "¡Puñalada!", new Color(0.75f, 0.6f, 1f));
        return Mathf.Max(1f, ServerTraitValue("punalada", 2f)) * CombatMath.CritMultiplier;
    }

    /// <summary>Tras el golpe: si lo mató desde la sombra (puñalada, asalto o danza), cuenta para el rasgo.</summary>
    [Server]
    public void ServerShadowDealt(bool killed, bool boss)
    {
        if (!killed || !IsShadowTrait || Time.time >= shadowKillUntil) return;
        ServerTraitProgress("muertes_sombra", 1);
        if (boss) ServerTraitProgress("jefes_sombra", 1);
    }

    // Golpe propio del asalto o la danza: ataque × mult, siempre crítico, a la espalda
    [Server]
    void ShadowStrikeAt(NPCEnemy t, float mult)
    {
        shadowKillUntil = Time.time + 0.5f;
        ServerPlayFx("tajo", t.transform.position);
        ServerPlayAttackAnim();
        int raw = Mathf.Max(1, Mathf.RoundToInt(ServerAttackStrength * mult * CombatMath.CritMultiplier));
        shadowOwnStrike = true;
        try { t.TakeDamageFrom(raw, connectionToClient); }
        finally { shadowOwnStrike = false; }
    }

    // A la espalda del enemigo, visto desde "from" (sin meterse en una pared)
    Vector2 BehindOf(NPCEnemy t, Vector2 from, Vector2 fallbackDir)
    {
        Vector2 at = t.transform.position;
        Vector2 away = at - from; if (away.sqrMagnitude < 0.01f) away = fallbackDir; away.Normalize();
        float gap = Mathf.Min(0.8f * GameScale.Tile, Mathf.Max(0f, SkillExecutor.WallDistance(at, away, 0.8f * GameScale.Tile) - 0.3f));
        return at + away * gap;
    }

    // ── Cada fotograma ───────────────────────────────────────────────────────────────────

    [Server]
    void ServerShadowTick()
    {
        if (!IsShadowTrait || sv_dead)
        {
            if (sv_shadowHidden) SetShadowHidden(false, false);
            ShadowPurgeMarks(clear: true);
            return;
        }
        ShadowRefill();
        ShadowPurgeMarks();
        if (sv_shadowHidden && !shadowMeld && Time.time >= shadowHiddenUntil) SetShadowHidden(false, false);
    }

    // ── Uno con las sombras (rango C) ────────────────────────────────────────────────────

    /// <summary>Efecto "shadow_meld": oculto hasta que ataca (el golpe que le descubre es puñalada si tiene el rango D).</summary>
    [Server]
    public void ServerShadowMeld()
    {
        SetShadowHidden(true, meld: true);
        ServerPlayFx("humo_calavera", transform.position);
        RpcStatusText("Uno con las sombras", new Color(0.7f, 0.6f, 1f));
    }

    // ── Asalto de sombra (rango A) ───────────────────────────────────────────────────────

    /// <summary>Efecto "shadow_assault": señuelo donde estaba, aparece a la espalda del marcado más cercano, golpe crítico
    /// (ataque × mult) y la marca se consume.</summary>
    [Server]
    public void ServerShadowAssault(SkillEffect e)
    {
        var t = NearestMark();
        if (t == null) return;
        Vector2 from = transform.position;
        ServerShadowDecoy(from);
        Vector2 dest = BehindOf(t, from, DirFromFacing());
        ServerPlayFx("parpadeo", from);
        ServerDashTo(dest);
        ServerPlayFx("parpadeo", dest);
        if (sv_shadowHidden) SetShadowHidden(false, false);
        ShadowUnmark(t);
        float mult = e.mult > 0f ? e.mult : ServerTraitValue("asalto_mult", 2f);
        RpcStatusText("¡Asalto de sombra!", new Color(0.75f, 0.6f, 1f));
        ShadowStrikeAt(t, mult);
        ServerTraitProgress("punaladas", 1);
        PushVitals();
    }

    [Server]
    void ServerShadowDecoy(Vector2 at)
    {
        float secs = Mathf.Max(0.5f, ServerTraitValue("senuelo_seg", 3f));
        var go = new GameObject("SenueloSombra");
        SceneManager.MoveGameObjectToScene(go, gameObject.scene);   // el servidor tiene cada mapa en su escena
        go.transform.position = at;
        go.AddComponent<ShadowDecoy>().phaseOwner = gameObject;
        Destroy(go, secs);
        float r = ServerTraitValue("senuelo_radio", 5f) * GameScale.Tile;
        foreach (var t in SkillExecutor.EnemiesInCircle(at, r, this)) t.ServerTaunt(go.transform, secs);
        RpcShadowDecoy(at, secs);
    }

    // ── Danza de sombras (rango S) ───────────────────────────────────────────────────────

    [Server]
    public void ServerShadowDance(SkillEffect e)
    {
        if (shadowDancing) return;
        StartCoroutine(ShadowDance(e));
    }

    IEnumerator ShadowDance(SkillEffect e)
    {
        int   max  = Mathf.Max(1, Mathf.RoundToInt(e.amount > 0f ? e.amount : ServerTraitValue("danza_max", 6f)));
        float mult = e.mult > 0f ? e.mult : ServerTraitValue("danza_mult", 1.5f);
        float r    = ServerTraitValue("danza_radio", 5f) * GameScale.Tile;
        Vector2 start = transform.position;
        var targets = SkillExecutor.EnemiesInCircle(start, r, this)
            .OrderBy(t => Vector2.Distance(start, t.transform.position)).Take(max).ToList();
        if (targets.Count == 0) yield break;

        shadowDancing = true;
        if (sv_shadowHidden) SetShadowHidden(false, false);
        RpcStatusText("¡Danza de sombras!", new Color(0.75f, 0.6f, 1f));
        ServerPlayFx("parpadeo", start);
        Vector2 cur = start;
        foreach (var t in targets)
        {
            if (this == null || sv_dead) break;
            if (t == null || t.IsDeadServer) continue;
            cur = BehindOf(t, cur, Vector2.right);
            ServerDashTo(cur);
            ServerPlayFx("parpadeo", cur);
            ShadowStrikeAt(t, mult);
            yield return new WaitForSeconds(0.18f);
        }
        if (this != null && !sv_dead)
        {
            ServerDashTo(start);
            ServerPlayFx("parpadeo", start);
        }
        shadowDancing = false;
        PushVitals();
    }

    [Server]
    void ServerShadowStop()
    {
        shadowDancing = false;
        if (sv_shadowHidden) SetShadowHidden(false, false);
    }

    // ── Aspecto (clientes) ───────────────────────────────────────────────────────────────

    static readonly Color HiddenTint = new Color(0.62f, 0.5f, 1f, 0.42f);

    // El color lo pone UpdateBodyColor cada fotograma (NetworkPlayer.BodyColor.cs); aquí solo el sonido
    void OnShadowHiddenChanged(bool _, bool on) => GameAudio.PlayAt("magia/sombra", transform.position, 0.6f);
    void ApplyShadowTint(bool on) { }

    // Auras de las marcas: se cuadran con la lista del servidor (cada pocos fotogramas, NetworkPlayer.BodyColor.cs)
    readonly Dictionary<uint, ShadowMarkView> markViews = new();
    float markSyncAt;

    void SyncShadowMarkViews()
    {
        if (Time.time < markSyncAt) return;
        markSyncAt = Time.time + 0.2f;
        foreach (var id in markViews.Keys.ToList())
            if (!shadowMarkIds.Contains(id) || markViews[id] == null)
            {
                if (markViews[id] != null) markViews[id].Remove();
                markViews.Remove(id);
            }
        foreach (var id in shadowMarkIds)
            if (!markViews.ContainsKey(id) && NetworkClient.spawned.TryGetValue(id, out var ni) && ni != null)
                markViews[id] = ShadowMarkView.Attach(ni.gameObject);
    }

    [ClientRpc]
    void RpcShadowDecoy(Vector2 at, float secs)
    {
        var headSr = headAnimator != null ? headAnimator.GetComponent<SpriteRenderer>() : null;
        ShadowDecoyView.Show(at, bodySprite, headSr, secs);
    }
}
