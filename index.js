import { GoogleGenAI } from "@google/genai";
import readlineSync from 'readline-sync';
import { exec } from "child_process";
import { promisify } from "util";
import os from 'os'
import fs from "fs/promises";
import path from "path";


const platform = os.platform();

const bashPath = "C:\\Program Files\\Git\\usr\\bin\\bash.exe"; 

const asyncExecute = async (command) => {
  try {
    const { stdout, stderr } = await promisify(exec)(command, {
      shell: `"${bashPath}"`,
      env: process.env,
    });
    if (stderr) return `Error: ${stderr}`;
    return `Success: ${stdout} || Task executed completely`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
};


const History = [];
const ai = new GoogleGenAI({ apiKey: "AIzaSyDyxELEP0wKwrno0xEcMGOteiGMSWbUH_E" });

// Tool create karte hai, jo kisi bhi terminal/ shell command ko execute kar sakta hai
async function executeCommand({ command }) {
  console.log("📤 Executing command:\n", command);

  const trimmed = command.trim();

  const heredocMatch = trimmed.match(/^cat <<EOF > (.+?)\n([\s\S]*?)\nEOF$/);

  if (heredocMatch) {
    const filePath = heredocMatch[1].trim();
    const content = heredocMatch[2];

    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      console.log("✅ File written to:", filePath);
      return `✅ File written to ${filePath}`;
    } catch (err) {
      return `❌ Failed to write file: ${err.message}`;
    }
  }

  // Otherwise run as shell command (e.g. mkdir)
  try {
    const { stdout, stderr } = await asyncExecute(command);
    if (stderr) return `⚠️ Error: ${stderr}`;
    return `✅ Success: ${stdout}`;
  } catch (err) {
    return `❌ Exec failed: ${err.message}`;
  }
}


const executeCommandDeclaration = {
    name: "executeCommand",
    description: "Execute a single terminal/shell command. A command can be to create a folder, file, write on a file, edit the file or delete the file",
    parameters: {
        type: 'OBJECT',
        properties: {
            command: {
                type: 'STRING',
                description: 'It will be a single terminal command. Ex: "mkdir calculator"'
            },
        },
        required: ['command']
    }
}

const availableTools = {
    executeCommand
}

async function runAgent(userProblem) {
    History.push({
        role: 'user',
        parts: [{ text: userProblem }]
    });

    while (true) {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: History,
            config: {
                systemInstruction: `
You are a website-building expert. Your job is to help the user build a frontend website step-by-step using terminal commands.

✅ Tools Available:
- You can execute terminal or shell commands using the tool 'executeCommand'.

🖥️ Environment:
- The user's operating system is: ${platform}
- Assume they are using a Unix-like shell (such as Git Bash or WSL), even on Windows.
- You are allowed to use Unix shell syntax (like mkdir, touch, cat, etc.)

🚫 DO NOT use Windows cmd commands like 'echo' for multi-line file content.

✅ FOR WRITING FILE CONTENT:
- Always use the heredoc format: **cat <<EOF > filename**
- Start the content on a **new line**
- End with **EOF** on its own line with NO spaces or indentation
- Example:
  cat <<EOF > folder/index.html
  <!DOCTYPE html>
  <html>
    <head><title>My Site</title></head>
    <body>Hello</body>
  </html>
  EOF

📋 Your Workflow:
1. Create a folder: mkdir "project"
2. Create HTML, CSS, and JS files inside it using: touch "project/index.html"
3. Write code into those files using: cat <<EOF > "project/index.html"
4. Use only one shell command at a time.
5. Use the tool \`executeCommand\` for each shell command.

🎯 Your job is to analyze the user's query, understand what kind of website they want, and generate the necessary shell commands step-by-step using the above format.
`
,
                tools: [{
                    functionDeclarations: [executeCommandDeclaration]
                }],
            },
        });

        if (response.functionCalls && response.functionCalls.length > 0) {
            console.log(response.functionCalls[0]);
            const { name, args } = response.functionCalls[0];

            const funCall = availableTools[name];
            const result = await funCall(args);

            const functionResponsePart = {
                name: name,
                response: {
                    result: result,
                },
            };

            // model
            History.push({
                role: "model",
                parts: [
                    {
                        functionCall: response.functionCalls[0],
                    },
                ],
            });

            // result Ko history daalna
            History.push({
                role: "user",
                parts: [
                    {
                        functionResponse: functionResponsePart,
                    },
                ],
            });
        } else {
            History.push({
                role: 'model',
                parts: [{ text: response.text }]
            });
            console.log(response.text);
            break;
        }
    }
}

async function main() {
    console.log("I am a cursor: let's create a website");
    const userProblem = readlineSync.question("Ask me anything--> ");
    await runAgent(userProblem);
    main();
}

main();
