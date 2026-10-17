import { devPorts } from "leeway";
import config from "../leeway.json" with { type: "json" };

const ports = devPorts(config);

document.querySelector("#ports")!.textContent = JSON.stringify(ports, null, 4);

const response = await fetch(`http://localhost:${ports.PORT_API}/`);

document.querySelector("#api")!.textContent = await response.text();
