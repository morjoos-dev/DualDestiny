// Habilidades por piezas: FORMA (a quién alcanza) + EFECTOS (qué le hace) + efecto visual (vfx).
//
// Formas (shape):
//   strike      golpe: rectángulo delante del jugador (range = largo)
//   projectile  proyectil (range, projectileSpeed; opciones pierce, homing, explodeRadius)
//   beam        rayo recto hasta el primer enemigo, o todos con pierce (range)
//   line        brota por tramos a lo largo del camino (range, step = distancia entre tramos,
//               stepDelay = segundos entre tramos, width = ancho de cada tramo)
//   around      área alrededor del jugador (aoeRadius)
//   area        área en el punto al que apuntas, a "range" de distancia (aoeRadius)
//   self        solo sobre el lanzador
//   dash        desplazamiento: dashKind "charge" (embestida) | "blink" (teletransporte); golpea al llegar (aoeRadius)
//
// Efectos (effects[]), cada uno { type, amount, mult, pct, duration, stat, status }:
//   damage     daño: amount + atributo (Fuerza/Inteligencia según elemento) × mult        → a los alcanzados
//   heal       cura amount (+ pct % de la vida máxima)                                  → al lanzador
//   lifesteal  cura pct % del daño hecho por esta habilidad                             → al lanzador
//   manadrain  quita amount de maná al objetivo y se lo da al lanzador                  → alcanzados
//   dot        estado dañino status (burn|poison|bleed): amount por segundo, duration s  → alcanzados
//   control    status (slow|stun|silence): slow reduce la velocidad pct %, duration s     → alcanzados
//   buff       +amount a stat (strength|defense|dexterity|intelligence|speed|lifesteal|invisible), duration s → lanzador
//   debuff     −amount a stat del objetivo (defense|damage|speed), duration s             → alcanzados
//   shield     absorbe amount de daño durante duration s                                → al lanzador
//   knockback  empuja amount unidades                                                   → alcanzados
//   taunt      los enemigos alcanzados atacan al lanzador durante duration s            → alcanzados
//   raise      alza el alma más cercana como esbirro (rasgo Nigromante: cuántos, duración y poder
//              los pone el rango del rasgo; sin alma cerca no se lanza ni se paga)        → lanzador
//   detonate   hace estallar al esbirro más cercano del lanzador: daño en área (Nigromante D)  → alrededor del esbirro
//   sacrifice  consume al esbirro con más vida y cura al lanzador pct % de esa vida (Nigromante C) → lanzador
//   morph      abre el selector de formas aprendidas (Metamorfo); el servidor del juego aplica la forma (CmdMorph) → lanzador
//   dragon_guard  Coraza (Piel de dragón D): duration s parando pct % del daño y devolviendo amount %   → lanzador
//   dragon_roar   Rugido (A): provoca a los enemigos en amount casillas durante duration s            → alrededor
//   dragon_awaken Despertar dracónico (S): forma de dragón duration s, +pct % defensa, devuelve amount % → lanzador
//   fly        Vuelo (activar/desactivar): cruza agua, lava y abismos; gasta amount de maná por segundo → lanzador
//   ignite     Sangre ardiente: enciende la llama / sube de nivel / la apaga en el último (el rango pone los números) → lanzador
//   flame_final Llama final (Sangre ardiente S): la vida que te falta × pct % en daño en amount casillas  → alrededor
//   shadow_step Paso de sombra: teletransporte hacia donde mira; el rango pone alcance, cargas, ocultarse... → lanzador
//   shadow_meld Uno con las sombras (C): oculto hasta que ataca → lanzador
//   shadow_assault Asalto de sombra (A): señuelo y a la espalda del marcado más cercano, golpe crítico (ataque × mult) → objetivo
//   shadow_dance Danza de sombras (S): salta entre hasta amount enemigos y apuñala (ataque × mult), intocable → alrededor
//   army       alza a la vez las almas alzadas en el último minuto, unos segundos (Nigromante S) → lanzador
//
// Las habilidades antiguas (solo effectType) se convierten al vuelo con fromLegacy(): así Unity y el
// panel siempre reciben forma + efectos, y al guardar en el panel quedan ya en el formato nuevo.

const SHAPES  = ['strike', 'projectile', 'beam', 'line', 'around', 'area', 'self', 'dash'];
const EFFECTS = ['damage', 'heal', 'lifesteal', 'manadrain', 'dot', 'control', 'buff', 'debuff', 'shield', 'knockback', 'taunt', 'raise', 'detonate', 'army', 'sacrifice', 'morph', 'dragon_guard', 'dragon_roar', 'dragon_awaken', 'fly', 'ignite', 'flame_final', 'shadow_step', 'shadow_dance', 'shadow_meld', 'shadow_assault'];
const PASSIVE_TYPES = ['stat_bonus', 'hp_regen', 'mp_regen'];

function isPassive(s) { return s.isPassive === true || PASSIVE_TYPES.includes(s.effectType); }

/// Forma, opciones y efectos equivalentes a una habilidad antigua (solo effectType + números sueltos).
function fromLegacy(s) {
    const t     = s.effectType || '';
    const dmg   = () => ({ type: 'damage', amount: s.damage || 0, mult: s.damageMultiplier != null ? s.damageMultiplier : 1 });
    const dur   = s.statusDuration > 0 ? s.statusDuration : 3;
    const tick  = s.statusTickDamage > 0 ? s.statusTickDamage : Math.max(1, Math.round((s.damage || 5) * 0.2));
    const opts  = {};
    let shape = 'strike', effects = [dmg()];

    switch (t) {
        case 'melee_strike': case 'execute':      shape = 'strike'; break;
        case 'whirlwind':                           shape = 'around'; break;
        case 'charge':                              shape = 'dash'; opts.dashKind = 'charge'; break;
        case 'projectile':                          shape = 'projectile'; break;
        case 'projectile_piercing':                 shape = 'projectile'; opts.pierce = true; break;
        case 'projectile_aoe':                      shape = 'projectile'; opts.explodeRadius = s.aoeRadius > 0 ? s.aoeRadius : 1.5; break;
        case 'projectile_homing':                   shape = 'projectile'; opts.homing = true; break;
        case 'beam': case 'beam_wide':              shape = 'beam'; break;
        case 'beam_piercing':                       shape = 'beam'; opts.pierce = true; break;
        case 'apply_bleed':  effects.push({ type: 'dot', status: 'bleed',  amount: tick, duration: dur }); break;
        case 'apply_poison': effects.push({ type: 'dot', status: 'poison', amount: tick, duration: dur }); break;
        case 'apply_burn':   effects.push({ type: 'dot', status: 'burn',   amount: tick, duration: dur }); break;
        case 'apply_frostbite': effects.push({ type: 'control', status: 'slow', pct: 40, duration: dur }); break;
        case 'debuff_slow':  shape = 'projectile'; effects = [{ type: 'control', status: 'slow', pct: 40, duration: dur }]; break;
        case 'debuff_weaken': effects = [{ type: 'debuff', stat: 'damage',  amount: s.value || 5, duration: dur }]; break;
        case 'debuff_expose': effects = [{ type: 'debuff', stat: 'defense', amount: s.value || 5, duration: dur }]; break;
        case 'stun':         effects.push({ type: 'control', status: 'stun', duration: s.statusDuration > 0 ? s.statusDuration : 1.5 }); break;
        case 'silence':      effects = [{ type: 'control', status: 'silence', duration: dur }]; break;
        case 'lifesteal_strike': effects.push({ type: 'lifesteal', pct: s.lifestealPct > 0 ? s.lifestealPct : 30 }); break;
        case 'mana_drain':   effects.push({ type: 'manadrain', amount: s.value || Math.max(5, s.damage || 5) }); break;
        case 'holy_smite':   effects.push({ type: 'lifesteal', pct: 30 }); break;
        case 'necro_drain':  shape = 'around'; effects.push({ type: 'lifesteal', pct: 50 }); break;
        case 'vampiric_aura': shape = 'self'; effects = [{ type: 'buff', stat: 'lifesteal', amount: s.lifestealPct || 20, duration: dur > 3 ? dur : 10 }]; break;
        case 'shield_barrier': shape = 'self'; effects = [{ type: 'shield', amount: s.damage || s.value || 30, duration: dur > 3 ? dur : 8 }]; break;
        case 'heal_self': case 'heal_ally': shape = 'self'; effects = [{ type: 'heal', amount: s.damage || s.value || 20 }]; break;
        case 'dash':         shape = 'dash'; opts.dashKind = 'charge'; effects = []; break;
        case 'blink':        shape = 'dash'; opts.dashKind = 'blink';  effects = []; break;
        case 'shadow_step':  shape = 'dash'; opts.dashKind = 'blink'; break;
        case 'taunt':        shape = 'around'; effects = [{ type: 'taunt', duration: dur }]; break;
        case 'buff_rage':     shape = 'self'; effects = [{ type: 'buff', stat: 'strength',  amount: s.value || 5,  duration: dur > 3 ? dur : 10 }]; break;
        case 'buff_fortify':  shape = 'self'; effects = [{ type: 'buff', stat: 'defense',   amount: s.value || 5,  duration: dur > 3 ? dur : 10 }]; break;
        case 'buff_haste':    shape = 'self'; effects = [{ type: 'buff', stat: 'speed',     amount: s.value || 30, duration: dur > 3 ? dur : 6 }]; break;
        case 'buff_invisible': shape = 'self'; effects = [{ type: 'buff', stat: 'invisible', amount: 1,           duration: dur > 3 ? dur : 5 }]; break;
        case 'summon':       shape = 'self'; effects = []; break;   // invocar: aún no existe (ver ESTADO_PROYECTO)
    }
    // Estado antiguo suelto (statusEffect + statusDuration) en cualquier tipo: se conserva
    if (s.statusEffect && !effects.some(e => e.status === s.statusEffect)) {
        const st = s.statusEffect;
        if (['burn', 'poison', 'bleed'].includes(st)) effects.push({ type: 'dot', status: st, amount: tick, duration: dur });
        else if (st === 'frostbite' || st === 'slow') effects.push({ type: 'control', status: 'slow', pct: 40, duration: dur });
        else if (st === 'stun' || st === 'silence')   effects.push({ type: 'control', status: st, duration: dur });
        else if (st === 'weaken') effects.push({ type: 'debuff', stat: 'damage',  amount: 5, duration: dur });
        else if (st === 'expose') effects.push({ type: 'debuff', stat: 'defense', amount: 5, duration: dur });
    }
    return { shape, shapeOpts: opts, effects };
}

/// Objeto listo para enviar: si la habilidad activa aún no tiene forma, se le calcula.
function withShape(obj) {
    if (!obj || isPassive(obj)) return obj;
    if (!obj.shape) {
        const conv = fromLegacy(obj);
        obj.shape     = conv.shape;
        obj.shapeOpts = { ...(obj.shapeOpts || {}), ...conv.shapeOpts };
        obj.effects   = conv.effects;
        obj.converted = true;   // para el panel: "convertida automáticamente, revisa y guarda"
    }
    return obj;
}

/// Errores de una habilidad por piezas (para el panel al guardar).
function validate(s) {
    const errors = [];
    if (isPassive(s)) return errors;
    if (!SHAPES.includes(s.shape)) errors.push(`Forma "${s.shape}" desconocida (${SHAPES.join(', ')})`);
    for (const e of s.effects || [])
        if (!EFFECTS.includes(e.type)) errors.push(`Efecto "${e.type}" desconocido (${EFFECTS.join(', ')})`);
    if (s.shape !== 'self' && s.shape !== 'dash' && !(s.effects || []).length)
        errors.push('Una habilidad que alcanza a otros necesita al menos un efecto (p. ej. Daño)');
    return errors;
}

module.exports = { SHAPES, EFFECTS, fromLegacy, withShape, validate, isPassive };
