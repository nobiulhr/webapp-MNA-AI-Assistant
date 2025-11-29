import { GoogleGenAI, Type } from "@google/genai";
import type { ActionItem, ScribeResponse, ExportFormat, Status, Priority, TaskType } from '../types';

if (!process.env.API_KEY) {
    // This is a placeholder for development. In a real environment, the key would be set.
    // The framework is expected to inject this.
    console.warn("API_KEY environment variable not set. Using a placeholder.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

const generateContentWithRetry = async (params: any, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await ai.models.generateContent(params);
        } catch (error: unknown) {
            console.error(`API call failed (attempt ${i + 1}/${retries}):`, error);

            if (i === retries - 1) {
                let userFriendlyMessage = "Sorry, I'm having trouble connecting to my services. Please try again in a moment.";

                if (error instanceof Error) {
                    const errorMessage = error.message.toLowerCase();

                    if (errorMessage.includes('api key not valid')) {
                        userFriendlyMessage = "There appears to be an issue with the API configuration. Please ensure the API key is correct and valid.";
                    } else if (errorMessage.includes('safety')) {
                        userFriendlyMessage = "I'm sorry, but your request could not be processed due to safety settings. Please modify your input and try again.";
                    } else if (errorMessage.includes('400 bad request') || errorMessage.includes('invalid argument')) {
                        userFriendlyMessage = "There was a problem with the request format. Please try rephrasing your input.";
                    } else if (errorMessage.includes('quota')) {
                        userFriendlyMessage = "The request limit has been reached for the day. Please try again later.";
                    } else if (errorMessage.includes('503 service unavailable')) {
                        userFriendlyMessage = "The service is temporarily unavailable. Please try again in a few minutes.";
                    }
                }
                
                // Re-throw a new error with a message that's safe to show the user.
                throw new Error(userFriendlyMessage);
            }

            // Use exponential backoff for retries.
            await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
        }
    }
    throw new Error("API call failed after multiple retries.");
};


export const processNote = async (note: string, existingItems: ActionItem[]): Promise<ScribeResponse> => {
    const systemInstruction = `You are "MNA," an AI-powered work assistant. Your primary function is to help users capture and organize tasks.
    The current date and time is: ${new Date().toISOString()}. Use this as the reference for all date and time calculations.
    Your behavior is governed by the following rules:
    1. Language: You MUST respond in clear, professional English at all times, regardless of the language of the user's input.
    2. Core State: You maintain a cumulative list of "Action Items". Each new user input is an addition to this list. You will be provided the current list with each call.
    3. Processing Each Input: For every new transcript, analyze it to identify:
       - [Action Items]: The task to be done.
       - [Deadlines]: The due date. Resolve relative dates (e.g., "EOD Friday") to a specific date string.
       - [Reminder]: A specific date and time for a notification. Resolve any relative dates/times (e.g., "tomorrow at 9am", "next Monday") into a specific, future ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) based on the current date and time provided above. If no time is specified, default to a reasonable time like 9:00 AM local time. If no reminder is mentioned, use 'not set'.
       - [Priority]: The urgency (High, Medium, Low, or None). Infer from language (e.g., "urgent", "ASAP" is High; "when you have time" is Low). If ambiguous, set to 'None'.
       - [Responsible Person]: The person assigned to the task. If no person is mentioned, use 'Unassigned'.
       - [Status]: The current progress of the task. All new tasks MUST be set to 'Not Started'.
       - [Task Type]: The category of the task. Must be one of 'Self', 'Delegated', 'Team', 'Personal'. Infer this from the context. "I need to..." is 'Self'. "Tell Bob to..." is 'Delegated'. "We should..." is 'Team'. If a task seems non-work-related, use 'Personal'. If ambiguous, default to 'Self'.
       - The user's input is the [Source].
    4. Handling Missing Information (MANDATORY):
       - If a task is found with NO deadline: You MUST ask for it. Example: "I've noted the task: 'Send the client proposal.' What's the deadline for that?"
       - If the transcript has NO clear task: You MUST ask for clarification. Example: "Got it. Were there any specific action items or deadlines from that part you'd like me to record?"
    5. The Cumulative Loop (MANDATORY): After processing, you MUST end your response by asking: "Noted. Do you have more to add, or would you like me to generate the final summary?"

    Current Action Items: ${JSON.stringify(existingItems.map(({id, ...rest}) => rest))}
    New User Note: "${note}"

    Based on the new note, identify new action items and formulate your response text according to the rules. If you find a new task, acknowledge it first before asking the cumulative loop question.
    `;

    const response = await generateContentWithRetry({
        model: 'gemini-2.5-flash',
        contents: note,
        config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    newItems: {
                        type: Type.ARRAY,
                        description: "A list of new action items found in the user's note.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                task: { type: Type.STRING, description: "The specific action item." },
                                deadline: { type: Type.STRING, description: "The deadline for the task. Use 'not specified' if not found." },
                                reminder: { type: Type.STRING, description: "The reminder for the task in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ). Use 'not set' if not specified." },
                                priority: { type: Type.STRING, description: "The priority of the task (High, Medium, Low, or None)." },
                                responsible: { type: Type.STRING, description: "The person responsible for the task. Use 'Unassigned' if not specified." },
                                status: { type: Type.STRING, description: "The status of the task. Must be 'Not Started' for all new items." },
                                source: { type: Type.STRING, description: "The user's original note." },
                                type: { type: Type.STRING, description: "The type of task ('Self', 'Delegated', 'Team', 'Personal')."}
                            },
                            required: ["task", "deadline", "reminder", "priority", "responsible", "status", "source", "type"]
                        }
                    },
                    responseText: {
                        type: Type.STRING,
                        description: "Your full response to the user, strictly following the persona rules for clarification and the cumulative loop question."
                    }
                },
                required: ["newItems", "responseText"]
            }
        }
    });

    const jsonText = response.text.trim();
    return JSON.parse(jsonText);
};

export const updateActionItem = async (itemToUpdate: ActionItem, updateInstructions: string): Promise<Omit<ActionItem, 'id'>> => {
    const { id, ...itemForApi } = itemToUpdate;
    const systemInstruction = `You are "MNA," an AI assistant specializing in updating structured task data based on user instructions.
- The current date and time is: ${new Date().toISOString()}. Use this as the reference for all date and time calculations.
- Current Item: ${JSON.stringify(itemForApi)}
- User's Instructions: "${updateInstructions}"

Your task is to parse the user's instructions and return a complete, updated JSON object for the action item.

**Rules for Updating:**
1.  **Analyze the instruction:** Determine which fields ('task', 'deadline', 'priority', 'responsible', 'status', 'type', 'reminder') the user wants to change.
2.  **Preserve unchanged fields:** If a field is not mentioned in the instruction, you MUST retain its original value from the "Current Item". This is critical for partial updates.
3.  **'source' is immutable:** The 'source' field MUST NOT be changed under any circumstances. The 'id' field is managed by the system and should not be in your output.
4.  **Handle 'responsible':** If the instruction is about assigning the task (e.g., "assign to [Name]", "[Name] is responsible for this", "make [Name] the owner"), update the \`responsible\` field to "[Name]". If they say "unassign it", set it to "Unassigned".
5.  **Handle 'status':** If the user says "mark as complete", "it's done", etc., set \`status\` to "Completed". If they say "I'm starting on this", "in progress", set it to "In Progress".
6.  **Handle 'type':** If the user says "make this a team task", "change type to personal", etc., set \`type\` to the appropriate value ('Self', 'Delegated', 'Team', 'Personal').
7.  **Handle 'reminder' and 'deadline':** If the user provides a relative date/time (e.g., "remind me tomorrow at 9am", "deadline next monday"), resolve it into a specific, future format based on the current date and time provided. For reminders, use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ). For deadlines, use a human-readable date string. If they say "remove reminder", set it to "not set".
8.  **Return complete JSON:** Your response must be ONLY the final, complete JSON object.

**Example 1 (Multiple fields):**
- Current Item: {"task":"Submit report","deadline":"EOD Friday","reminder":"not set", "priority":"High","responsible":"Alex","status":"Not Started", "source":"...", "type": "Self"}
- User's Instructions: "Change the deadline to Monday, and remind me at 8am that day."
- Expected Output (JSON only): {"task":"Submit report","deadline":"Monday","reminder":"[ISO 8601 for next Monday at 8am]","priority":"High","responsible":"Alex","status":"Not Started", "source":"...", "type":"Self"}`;
    
    const response = await generateContentWithRetry({
        model: 'gemini-2.5-flash',
        contents: updateInstructions,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    task: { type: Type.STRING, description: "The updated action item text." },
                    deadline: { type: Type.STRING, description: "The updated deadline for the task." },
                    reminder: { type: Type.STRING, description: "The updated reminder for the task in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ). Use 'not set' if not specified." },
                    priority: { type: Type.STRING, description: "The updated priority of the task (High, Medium, Low, or None)." },
                    responsible: { type: Type.STRING, description: "The updated person responsible for the task." },
                    status: { type: Type.STRING, description: "The updated status of the task ('Not Started', 'In Progress', 'Completed')." },
                    source: { type: Type.STRING, description: "The original source note, which must not be changed." },
                    type: { type: Type.STRING, description: "The updated type of task ('Self', 'Delegated', 'Team', 'Personal')."}
                },
                required: ["task", "deadline", "reminder", "priority", "responsible", "status", "source", "type"]
            }
        }
    });

    const jsonText = response.text.trim();
    return JSON.parse(jsonText);
};


export const generateSummary = async (items: ActionItem[]): Promise<string> => {
    const prompt = `Generate a complete "Actionable Work Summary" in English based on the following list of action items.
    The entire summary, including the overview and the bulleted list, MUST be in English.
    The summary must have two parts:
    1. Overview: A 1-2 sentence narrative summary of the work identified.
    2. Action Items: A clear, bulleted list of all tasks.
    Format:
    - [Task] (Type: [Task Type], Status: [Status], Assigned to: [Responsible Person], Priority: [Priority]): Due by [Deadline]
    - If a reminder is set, add it in parentheses, e.g., (Reminder: [Reminder Time]).
    - If no deadline was ever given, use: Due by [Deadline not specified]
    - If priority is 'None', you can omit it.
    - If responsible is 'Unassigned', you can omit the 'Assigned to' part.
    
    Action Items List:
    ${JSON.stringify(items)}
    `;

    const response = await generateContentWithRetry({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text;
};

export const generateExportContent = async (items: ActionItem[], format: ExportFormat): Promise<string> => {
    let prompt = '';
    
    switch (format) {
        case 'markdown':
            prompt = `Generate a complete "Actionable Work Summary" in Markdown format, written in English, based on the following list of action items.
The summary must have two parts:
1. Overview: A 1-2 sentence narrative summary of the work identified, written in English.
2. Action Items: A clear, bulleted list of all tasks, formatted as Markdown, including their type, status, priority, reminder, and the person responsible. All text must be in English.
---
Action Items List:
${JSON.stringify(items)}`;
            break;
        case 'json':
            prompt = `Convert the following list of action items into a valid JSON array. The JSON should include "task", "status", "responsible", "priority", "deadline", "reminder", "source", and "type".
The output should ONLY be the JSON data, enclosed in a markdown JSON code block.
---
Action Items List:
${JSON.stringify(items)}`;
            break;
        case 'csv':
            prompt = `Convert the following list of action items into a robust, RFC 4180 compliant CSV format.
The output should ONLY be the CSV data, enclosed in a markdown code block.

**CSV Generation Rules (MUST be followed):**
1.  **Header:** The first line MUST be the header: "task","status","responsible","priority","deadline","reminder","source","type".
2.  **Delimiter:** Use a comma (,) as the field delimiter.
3.  **Quoting:**
    - Fields containing a comma (,), a double quote ("), or a newline character MUST be enclosed in double quotes.
    - If a field is enclosed in double quotes, any double quote characters within the field's content MUST be escaped by doubling them (e.g., " becomes "").
4.  **No extra whitespace:** Do not add leading or trailing whitespace around fields unless it's part of the data.

---
Action Items List:
${JSON.stringify(items)}`;
            break;
    }

    const response = await generateContentWithRetry({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text;
};