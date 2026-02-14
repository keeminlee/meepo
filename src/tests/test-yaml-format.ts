/**
 * Test YAML formatting with newline separators
 */

import fs from "fs";
import path from "path";
import yaml from "yaml";

const testYaml = `version: 1

characters:
  - id: npc_test1
    canonical_name: "Test One"
    aliases: []
    notes: ""

  - id: npc_test2
    canonical_name: "Test Two"
    aliases: []
    notes: ""
`;

const testPath = path.join(process.cwd(), "data", "test_yaml_format.yml");

// Write test file
fs.writeFileSync(testPath, testYaml);

// Simulate appendToYaml logic
const content = fs.readFileSync(testPath, "utf-8");
const data = yaml.parse(content);

// Check if array is empty
const wasEmpty = data.characters.length === 0;

// Add a new entry
const newEntry = {
  id: "npc_test3",
  canonical_name: "Test Three",
  aliases: [],
  notes: "",
};

data.characters.push(newEntry);

// Stringify with formatting
let output = yaml.stringify(data);

// Add blank line before the new entry if array wasn't empty
if (!wasEmpty) {
  const lines = output.split('\n');
  let lastIdIndex = -1;
  
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^  - id:/)) {
      lastIdIndex = i;
      break;
    }
  }
  
  if (lastIdIndex > 0) {
    lines.splice(lastIdIndex, 0, '');
    output = lines.join('\n');
  }
}

// Write result
fs.writeFileSync(testPath, output);

// Read and display
const result = fs.readFileSync(testPath, "utf-8");
console.log("📄 Formatted YAML:\n");
console.log(result);

// Cleanup
fs.unlinkSync(testPath);

// Check if blank line is before last entry
const hasBlankLineBeforeLast = /\n\n  - id: npc_test3/.test(result);
console.log(hasBlankLineBeforeLast ? "✅ Blank line added before new entry!" : "❌ No blank line before new entry");

