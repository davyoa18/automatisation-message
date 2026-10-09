/**
 * Propose des créneaux d'appel plausibles (jours ouvrés, heure de Paris, dates absolues) quand
 * aucun outil de réservation n'est branché. Les créneaux sont des suggestions : l'équipe confirme toujours.
 */
export function suggestSlots(now: Date, tz = "Europe/Paris", count = 3): string[] {
  const hours = [
    [10, 0],
    [14, 30],
    [17, 30],
  ] as const;
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("fr-FR", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return { weekday: get("weekday"), day: get("day"), month: get("month"), hour: Number(get("hour")), minute: Number(get("minute")) };
  };
  const out: string[] = [];
  // On part du lendemain si on est après 16 h, sinon on peut proposer le jour même.
  const nowP = parts(now);
  let dayOffset = nowP.hour >= 16 ? 1 : 0;
  while (out.length < count && dayOffset < 10) {
    const day = new Date(now.getTime() + dayOffset * 86_400_000);
    const p = parts(day);
    const isWeekend = p.weekday === "samedi" || p.weekday === "dimanche";
    if (!isWeekend) {
      // Un créneau par jour, à une heure qui tourne d'un jour à l'autre pour varier les propositions.
      const ordered = [...hours.slice(out.length % hours.length), ...hours.slice(0, out.length % hours.length)];
      const slot = ordered.find(([h, m]) => dayOffset > 0 || h > nowP.hour + 2 || (h === nowP.hour + 2 && m >= nowP.minute));
      if (slot) {
        const [h, m] = slot;
        // Date absolue : le message peut être lu le lendemain, « demain » deviendrait faux.
        out.push(`${p.weekday} ${p.day} ${p.month} à ${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`);
      }
    }
    dayOffset++;
  }
  return out;
}
