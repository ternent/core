#!/usr/bin/env node
import { renderGreeting } from "./index.js";
console.log(renderGreeting(process.argv[2] ?? "Concord"));
