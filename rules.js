<<<<<<< HEAD
function checkHealth(issue,weather){

if(issue.includes("not eating") && weather==="hot")
return "High Risk — isolate pigeon immediately";

if(issue.includes("weak"))
return "Provide vitamins";

return "Monitor condition";
}

module.exports=checkHealth;

function checkHealth(issue, weather){

if(issue.toLowerCase().includes("weak"))
return "Isolate pigeon and monitor feeding.";

if(issue.toLowerCase().includes("not eating"))
return "Check beak and throat for infection.";

if(issue.toLowerCase().includes("injury"))
return "Clean wound and separate pigeon.";

if(weather==="hot")
return "Ensure extra water is provided.";

if(weather==="cold")
return "Increase feed slightly.";

return "Monitor pigeon closely.";
}

module.exports = checkHealth;
=======
function checkHealth(issue,weather){

if(issue.includes("not eating") && weather==="hot")
return "High Risk — isolate pigeon immediately";

if(issue.includes("weak"))
return "Provide vitamins";

return "Monitor condition";
}

module.exports=checkHealth;

function checkHealth(issue, weather){

if(issue.toLowerCase().includes("weak"))
return "Isolate pigeon and monitor feeding.";

if(issue.toLowerCase().includes("not eating"))
return "Check beak and throat for infection.";

if(issue.toLowerCase().includes("injury"))
return "Clean wound and separate pigeon.";

if(weather==="hot")
return "Ensure extra water is provided.";

if(weather==="cold")
return "Increase feed slightly.";

return "Monitor pigeon closely.";
}

module.exports = checkHealth;
>>>>>>> c83536fb091a4aa7ed8f49f1121d2601613261db
