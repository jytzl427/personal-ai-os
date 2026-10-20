import http from "node:http";

async function main() {
  const getRes = await new Promise((resolve) => {
    http.get("http://127.0.0.1:4738/api/v1/projects/06e05bc8-6406-437a-9ceb-1f96602796d1", (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve(JSON.parse(b)));
    });
  });

  for (const t of getRes.project_tasks) {
    await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: 4738,
          path: "/api/v1/project-task-plans/" + t.id,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", resolve);
        }
      );
      req.write(JSON.stringify({ status: "done" }));
      req.end();
    });
    console.log("Marked done:", t.title);
  }
}

main();
