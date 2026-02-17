function checkHealth(issue,weather){

if(issue.includes("not eating") && weather==="hot")
return "High Risk — isolate pigeon immediately";

if(issue.includes("weak"))
return "Provide vitamins";

return "Monitor condition";
}

module.exports=checkHealth;
