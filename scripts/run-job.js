const http = require("http");

const job = process.argv[2];
const path = job === "daily" ? "/api/jobs/daily" : job === "settle" ? "/api/jobs/settle" : null;

if (!path) {
  console.error("Use: node scripts/run-job.js daily|settle");
  process.exit(1);
}

const port = process.env.PORT || 4173;
const req = http.request(
  {
    hostname: "127.0.0.1",
    port,
    path,
    method: "POST"
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk;
    });
    res.on("end", () => {
      console.log(body);
      process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
    });
  }
);

req.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

req.end();
