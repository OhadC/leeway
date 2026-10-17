import { devPorts } from "leeway";
import catalogue from "../leeway.json" with { type: "json" };

const ports = devPorts(catalogue);

document.querySelector("#ports")!.textContent = JSON.stringify(ports, null, 4);

const response = await fetch(`http://localhost:${ports.PORT_API}/`);

document.querySelector("#api")!.textContent = await response.text();
