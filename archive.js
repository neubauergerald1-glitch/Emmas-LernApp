/* =========================================================
   Archiv: Eine Überprüfung (Test, Schularbeit) wandert ARCHIV.DAYS Tage
   nach ihrem Termin automatisch ins Archiv. Ihre Übungen verschwinden dann
   aus der normalen Ansicht, bleiben aber im Archiv-Ordner spielbar.
   Ein Abschnitt (section) ist archiviert, wenn ALLE Überprüfungen, zu denen
   er gehört, archiviert sind. Wird von index.html und eltern.html genutzt.
   ========================================================= */
(function () {
  const DAYS = 3;
  const today0 = () => { const n = new Date(); n.setHours(0, 0, 0, 0); return n; };
  const daysSince = d => Math.round((today0() - new Date(d + "T00:00:00")) / 864e5);
  const testsOf = s => (s.tests && s.tests.length) ? s.tests : (s.test ? [{ name: "Test", date: s.test }] : []);
  function info(s) {
    const tests = testsOf(s).map(t => Object.assign({}, t, { archived: daysSince(t.date) >= DAYS }));
    const secIds = (s.sections && s.sections.length) ? s.sections.map(x => x.id) : null;
    const archivedSec = new Set();
    if (secIds) for (const id of secIds) {
      const ts = tests.filter(t => (t.sections || []).includes(id));
      if (ts.length && ts.every(t => t.archived)) archivedSec.add(id);
    }
    const isArchived = t => secIds ? archivedSec.has(t.section) : (tests.length > 0 && tests.every(x => x.archived));
    const topics = s.topics || [];
    const active = topics.filter(t => !isArchived(t));
    const archived = topics.filter(isArchived);
    return {
      tests, archivedSec, active, archived, isArchived,
      archivedTests: tests.filter(t => t.archived).sort((a, b) => b.date.localeCompare(a.date)),
      fullyArchived: topics.length > 0 && active.length === 0,
      // Übungen einer Überprüfung (bei Fächern ohne Abschnitte: alle)
      topicsOf: t => t.sections ? topics.filter(x => t.sections.includes(x.section)) : topics,
    };
  }
  window.ARCHIV = { DAYS, info, daysSince };
})();
