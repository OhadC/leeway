import http from "node:http";
import { devPorts } from "leeway";
import catalogue from "./leeway.json" with { type: "json" };

const port = devPorts(catalogue).PORT_API;

http.createServer((_, response) => {
    response.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" });
    response.end(`hello from the api on port ${port}`);
}).listen(port, () => console.log(`api listening on http://localhost:${port}`));
