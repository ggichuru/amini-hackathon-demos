/**
 * Runway — privacy-first cash-runway & financial-resilience engine.
 * Pure, dependency-free, deterministic. NEVER calls Date.now() (stays testable).
 *
 * MODEL: "if your income stopped today"
 *   runwayMonths = (savings + buffer) / monthlyExpenses
 *   -> how long your reserves cover FULL expenses with income at zero.
 *   Infinity ONLY when expenses <= 0 (there is nothing to spend against).
 *
 * All computation is local. Nothing in this file performs any I/O.
 */
(function (root) {
  'use strict';

  function num(x) {
    var n = (typeof x === 'number') ? x : Number(x);
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : n;
  }

  function roundRunway(m) {
    if (!isFinite(m)) return Infinity;
    return m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
  }

  function toYMD(d) {
    var y = d.getUTCFullYear();
    var mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    var da = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + mo + '-' + da;
  }

  function addMonthsUTC(asOf, months) {
    if (asOf === null || asOf === undefined) return null;
    var base = (typeof asOf === 'number') ? new Date(asOf) : new Date(String(asOf));
    if (isNaN(base.getTime())) return null;
    var whole = Math.floor(months);
    var frac = months - whole;
    var d = new Date(base.getTime());
    d.setUTCMonth(d.getUTCMonth() + whole);
    if (frac > 0) {
      var daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(d.getUTCDate() + Math.round(frac * daysInMonth));
    }
    return d;
  }

  function scoreFromRunway(m) {
    if (!isFinite(m)) return 100;
    if (m <= 0) return 0;
    if (m < 3)  return (m / 3) * 25;
    if (m < 6)  return 25 + ((m - 3) / 3) * 25;
    if (m < 12) return 50 + ((m - 6) / 6) * 25;
    if (m < 60) return 75 + ((m - 12) / 48) * 25;
    return 100;
  }

  function bandFromScore(s) {
    if (s < 25) return 'Critical';
    if (s < 50) return 'Fragile';
    if (s < 75) return 'Stable';
    return 'Resilient';
  }

  function headlineFor(runwayMonths) {
    if (!isFinite(runwayMonths)) return 'No expenses — reserves last indefinitely';
    var disp = roundRunway(runwayMonths);
    var word = disp === 1 ? 'month' : 'months';
    return disp + ' ' + word + ' if income stopped today';
  }

  function money(n) {
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  function explanationFor(runwayMonths, monthlyNet, trajectory) {
    var traj;
    if (trajectory === 'saving') traj = 'Right now you’re saving ' + money(monthlyNet) + '/month.';
    else if (trajectory === 'draining') traj = 'Right now you’re draining ' + money(monthlyNet) + '/month.';
    else traj = 'Right now you’re breaking even.';

    if (!isFinite(runwayMonths)) {
      return 'With expenses at zero, your reserves are not being drawn down. ' + traj;
    }
    var disp = roundRunway(runwayMonths);
    var word = disp === 1 ? 'month' : 'months';
    return 'If your income stopped today, your savings would cover your full expenses for about '
      + disp + ' ' + word + '. ' + traj;
  }

  function nextActionFor(band) {
    switch (band) {
      case 'Critical':  return 'Build a starter buffer: aim for one month of expenses in cash.';
      case 'Fragile':   return 'Grow reserves toward six months of expenses.';
      case 'Stable':    return 'Push toward twelve months to reach full resilience.';
      default:          return 'Maintain your reserves and put the surplus to work.';
    }
  }

  function computeResilience(input) {
    var o = (input && typeof input === 'object') ? input : {};
    var income   = num(o.income);
    var expenses = num(o.expenses);
    var savings  = num(o.savings);
    var buffer   = num(o.buffer);
    var asOf     = (o.asOf === undefined) ? null : o.asOf;

    var reserves = savings + buffer;
    var runwayMonths = expenses > 0 ? reserves / expenses : Infinity;

    var monthlyNet = income - expenses;
    var trajectory = monthlyNet > 0 ? 'saving' : (monthlyNet < 0 ? 'draining' : 'even');

    var scoreRaw = scoreFromRunway(runwayMonths);
    var band  = bandFromScore(scoreRaw);
    var score = Math.max(0, Math.min(100, Math.round(scoreRaw)));

    var zeroDate = null;
    if (isFinite(runwayMonths)) {
      var d = addMonthsUTC(asOf, runwayMonths);
      zeroDate = d ? toYMD(d) : null;
    }

    return {
      runwayMonths: runwayMonths,
      zeroDate: zeroDate,
      monthlyNet: monthlyNet,
      trajectory: trajectory,
      score: score,
      band: band,
      headline: headlineFor(runwayMonths),
      explanation: explanationFor(runwayMonths, monthlyNet, trajectory),
      nextAction: nextActionFor(band)
    };
  }

  var api = { computeResilience: computeResilience, roundRunway: roundRunway };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Runway = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
