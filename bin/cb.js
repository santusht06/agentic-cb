#!/usr/bin/env node
// Agentic CLI Browser Executable

import { createCLI } from '../src/cli.js';

const program = createCLI();
program.parse(process.argv);
