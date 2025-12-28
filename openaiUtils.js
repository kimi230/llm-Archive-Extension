/**
 * OpenAI API Utility
 * API Key is provided by the user through extension settings
 */

export async function generateMetadata(content, apiKey) {
    if (!apiKey || !apiKey.trim()) {
        throw new Error('API Key가 설정되지 않았습니다. 설정에서 OpenAI API Key를 입력해주세요.');
    }

    if (!content || !content.trim()) {
        throw new Error('Content is empty');
    }

    const systemPrompt = `
You are a helpful assistant that analyzes conversation logs.
Your task is to generate a concise title, a brief summary, and relevant tags for the provided markdown content.
`.trim();

    const jsonSchema = {
        name: "metadata_response",
        strict: true,
        schema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "A short, descriptive title (max 50 chars)."
                },
                summary: {
                    type: "string",
                    description: "A brief summary of the conversation (max 200 chars)."
                },
                tags: {
                    type: "array",
                    items: {
                        type: "string"
                    },
                    description: "An array of 3-5 relevant tags. Each tag must be a single word without spaces (use camelCase or hyphens for multi-word concepts, e.g., 'machineLearning' or 'web-development')."
                }
            },
            required: ["title", "summary", "tags"],
            additionalProperties: false
        }
    };

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: content.slice(0, 15000) }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: jsonSchema
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API Error: ${errorData.error?.message || response.statusText}`);
        }

        const dataText = await response.text();
        let data;
        try {
            data = JSON.parse(dataText);
        } catch (e) {
            console.error('Failed to parse API response as JSON:', dataText.slice(0, 200));
            throw new Error(`API response is not valid JSON. Response starts with: ${dataText.slice(0, 50)}`);
        }

        const result = JSON.parse(data.choices[0].message.content);
        return result;

    } catch (error) {
        console.error('Metadata generation failed:', error);
        throw error;
    }
}
