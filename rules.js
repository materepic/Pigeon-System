// Returns structured advice + severity for notifications
// severity: info | warning | critical
module.exports = function checkHealth(issueRaw) {
  const issue = String(issueRaw || "").toLowerCase();

  const criticalKeywords = ["not eating", "bleeding", "breathing", "paralysis", "seizure", "can't stand"];
  const warningKeywords = ["weak", "injury", "limp", "diarrhea", "vomit", "swollen", "sleepy", "feathers dull"];

  const hasCritical = criticalKeywords.some((k) => issue.includes(k));
  const hasWarning = warningKeywords.some((k) => issue.includes(k));

  if (hasCritical) {
    return {
      severity: "critical",
      advice:
        "High risk: isolate immediately, ensure warmth, provide clean water, and notify management urgently. Check throat/beak and breathing.",
    };
  }

  if (hasWarning) {
    return {
      severity: "warning",
      advice:
        "Monitor closely: separate if needed, ensure hydration, reduce stress, check droppings and feeding. If it worsens, notify management.",
    };
  }

  // default info
  return {
    severity: "info",
    advice:
      "Monitor condition. Record changes in behavior, feeding, droppings, and activity. If symptoms persist, report to management.",
  };
};