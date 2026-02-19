function checkHealth(issue, weather){

issue = issue.toLowerCase();

/* serious conditions */

if(issue.includes("not eating") && weather==="hot")
return "High Risk — isolate pigeon immediately and monitor hydration.";

if(issue.includes("injury"))
return "Clean wound, disinfect area, and isolate pigeon.";


/* moderate conditions */

if(issue.includes("weak"))
return "Provide vitamins and monitor feeding closely.";

if(issue.includes("sleepy"))
return "Observe for 24 hours and ensure hydration.";


/* weather-based guidance */

if(weather==="hot")
return "Ensure extra water is available and reduce feed slightly.";

if(weather==="cold")
return "Increase feed slightly and ensure warmth.";

if(weather==="rain")
return "Keep pigeons sheltered and monitor illness risk.";


/* default */

return "No critical issue detected. Continue monitoring.";
}

module.exports = checkHealth;
