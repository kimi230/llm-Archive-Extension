/**
 * OpenAI API Utility
 * API Key is provided by the user through extension settings
 */

// 공통 API 호출 헬퍼
async function callOpenAI(apiKey, systemPrompt, userContent, jsonSchema, maxTokens = 16384, model = 'gpt-5-mini') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            max_completion_tokens: maxTokens,
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

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

/**
 * Planning Agent - 대화를 분석하고 추출 계획 수립
 * @param {string} content - 대화 원문 (마크다운)
 * @param {string} apiKey - OpenAI API Key
 * @returns {Promise<Object>} - 추출 계획
 */
export async function planExtraction(content, apiKey) {
    if (!apiKey?.trim()) {
        throw new Error('API Key가 설정되지 않았습니다.');
    }
    if (!content?.trim()) {
        throw new Error('Content is empty');
    }

    const systemPrompt = `You are an expert at analyzing LLM conversation logs and extracting factual knowledge into well-organized documents.

Analyze the conversation and decide how to organize the knowledge into separate markdown documents.

**Document Planning Guidelines:**
- Create documents based on the CONTENT, not predefined categories
- Each document should have a clear, specific purpose (e.g., "React Hooks 개념 정리", "Docker 설정 가이드", "API 에러 해결법")
- If the conversation covers a single topic, create just ONE document
- If there are distinct topics or the content is better split, create multiple documents
- Consider: tutorials, concept explanations, troubleshooting guides, configuration guides, reference docs, etc.
- Each document should be self-contained and useful as standalone knowledge

**What to Extract:**
- Extract only FACTS, not TODOs or unresolved questions
- Include relevant code snippets, examples, and references
- Focus on actionable, reusable knowledge

Respond in the user's language (Korean if the conversation is in Korean).`;

    const jsonSchema = {
        name: "extraction_plan",
        strict: true,
        schema: {
            type: "object",
            properties: {
                folder_name: {
                    type: "string",
                    description: "Folder name: Clear, descriptive topic name without date prefix, e.g., 'React-Hooks-Guide'"
                },
                summary: {
                    type: "string",
                    description: "Brief summary of the entire conversation (max 200 chars)"
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 relevant tags. Each tag must be a single word without spaces (use camelCase or hyphens)."
                },
                documents: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: {
                                type: "string",
                                description: "Document title (will be used as filename), e.g., 'useEffect-완벽-가이드'"
                            },
                            description: {
                                type: "string",
                                description: "Brief description of what this document covers"
                            },
                            sections: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        heading: {
                                            type: "string",
                                            description: "Section heading"
                                        },
                                        key_points: {
                                            type: "array",
                                            items: { type: "string" },
                                            description: "Key points to cover in this section"
                                        }
                                    },
                                    required: ["heading", "key_points"],
                                    additionalProperties: false
                                },
                                description: "Sections to include in this document"
                            }
                        },
                        required: ["title", "description", "sections"],
                        additionalProperties: false
                    },
                    description: "List of documents to create (1 or more based on content)"
                }
            },
            required: ["folder_name", "summary", "tags", "documents"],
            additionalProperties: false
        }
    };

    return await callOpenAI(apiKey, systemPrompt, content.slice(0, 30000), jsonSchema, 16384, 'gpt-5.1');
}

/**
 * Writing Agent - 계획된 문서 생성
 * @param {string} content - 대화 원문
 * @param {Object} document - 문서 계획 (title, description, emoji, sections)
 * @param {string} apiKey - OpenAI API Key
 * @returns {Promise<Object>} - { title, content } 생성된 마크다운 내용
 */
export async function writeExtraction(content, document, apiKey) {
    if (!apiKey?.trim()) {
        throw new Error('API Key가 설정되지 않았습니다.');
    }

    const systemPrompt = `You are a technical writer creating clean, well-structured markdown documentation.

**Task:** Create a markdown document titled "${document.title}"
**Purpose:** ${document.description}

**Sections to write:**
${document.sections.map(s => `## ${s.heading}\n- ${s.key_points.join('\n- ')}`).join('\n\n')}

**Guidelines:**
- Use clear headings (## for main sections, ### for subsections)
- Include relevant code snippets with proper syntax highlighting
- Write in the same language as the original conversation
- Be concise but include enough context to be useful standalone
- Focus on FACTS only, not opinions or TODOs
- Make the content actionable and practical`;

    const jsonSchema = {
        name: "document_content",
        strict: true,
        schema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Final document title"
                },
                content: {
                    type: "string",
                    description: "Full markdown content (without frontmatter, without main title)"
                }
            },
            required: ["title", "content"],
            additionalProperties: false
        }
    };

    const result = await callOpenAI(apiKey, systemPrompt, content.slice(0, 20000), jsonSchema, 16384, 'gpt-5-mini');

    // 마크다운 헤더 추가
    const header = `# ${result.title}\n\n`;
    return {
        title: result.title,
        content: header + result.content
    };
}

export async function generateMetadata(content, apiKey) {
    if (!apiKey || !apiKey.trim()) {
        throw new Error('API Key가 설정되지 않았습니다. 설정에서 OpenAI API Key를 입력해주세요.');
    }

    if (!content || !content.trim()) {
        throw new Error('Content is empty');
    }

    const systemPrompt = `
You are an expert at analyzing LLM conversation logs and extracting factual knowledge.
Analyze the provided content and generate:
1. **title**: A clear, descriptive title based on the main topic. Do NOT include any date prefixes.
2. **summary**: A brief, factual summary of the core knowledge discussed (max 200 chars).
3. **tags**: 3-5 relevant single-word tags (camelCase or hyphens).

Respond in the user's language (Korean if the content is in Korean).`.trim();

    const jsonSchema = {
        name: "metadata_response",
        strict: true,
        schema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Clear, descriptive title without date prefix."
                },
                summary: {
                    type: "string",
                    description: "Brief factual summary (max 200 chars)."
                },
                tags: {
                    type: "array",
                    items: {
                        type: "string"
                    },
                    description: "3-5 relevant single-word tags (camelCase or hyphens)."
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
                model: 'gpt-5-mini',
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
