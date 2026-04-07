import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VercelAIProvider } from './vercel-provider.js'

vi.mock('./model-factory.js', () => ({
  createModelFromConfig: vi.fn(),
}))

vi.mock('./agent.js', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn().mockReturnValue(() => false),
}))

vi.mock('../../core/media.js', () => ({
  extractMediaFromToolOutput: vi.fn().mockReturnValue([]),
}))

import { createModelFromConfig } from './model-factory.js'
import { generateText } from './agent.js'

const mockCreateModelFromConfig = vi.mocked(createModelFromConfig)
const mockGenerateText = vi.mocked(generateText)

// ==================== Helpers ====================

function makeProvider(overrides?: { getTools?: () => Promise<Record<string, any>> }) {
  const getTools = overrides?.getTools ?? (async () => ({ toolA: {}, toolB: {} }))
  return new VercelAIProvider(getTools as any, async () => 'You are a trading assistant.', 10)
}

// ==================== ask() ====================

describe('VercelAIProvider — ask()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateModelFromConfig.mockResolvedValue({ model: {} as any, key: 'gpt-4o' })
    mockGenerateText.mockResolvedValue({ text: 'ok', steps: [] } as any)
  })

  it('calls generateText with model, tools, system, and prompt', async () => {
    const provider = makeProvider()
    await provider.ask('hello')

    expect(mockGenerateText).toHaveBeenCalledOnce()
    const call = mockGenerateText.mock.calls[0][0]
    expect(call).toHaveProperty('prompt', 'hello')
    expect(call).toHaveProperty('system', 'You are a trading assistant.')
    expect(call.tools).toHaveProperty('toolA')
    expect(call.tools).toHaveProperty('toolB')
  })

  it('returns text from generateText result', async () => {
    mockGenerateText.mockResolvedValue({ text: 'the answer', steps: [] } as any)
    const provider = makeProvider()
    const result = await provider.ask('question')
    expect(result.text).toBe('the answer')
  })

  it('returns empty string when text is null', async () => {
    mockGenerateText.mockResolvedValue({ text: null, steps: [] } as any)
    const provider = makeProvider()
    const result = await provider.ask('question')
    expect(result.text).toBe('')
  })
})

// ==================== generate() — tool filtering ====================

describe('VercelAIProvider — generate() tool filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateModelFromConfig.mockResolvedValue({ model: {} as any, key: 'gpt-4o' })
    mockGenerateText.mockResolvedValue({ text: 'ok', steps: [] } as any)
  })

  it('filters disabled tools from generateText call', async () => {
    const getTools = async () => ({ toolA: {} as any, toolB: {} as any, toolC: {} as any })
    const provider = new VercelAIProvider(getTools, async () => 'prompt', 5)

    const events = []
    for await (const e of provider.generate([], 'test', { disabledTools: ['toolB'] })) {
      events.push(e)
    }

    const call = mockGenerateText.mock.calls[0][0]
    const toolNames = Object.keys(call.tools!)
    expect(toolNames).toContain('toolA')
    expect(toolNames).not.toContain('toolB')
    expect(toolNames).toContain('toolC')
  })

  it('passes modelOverride to createModelFromConfig', async () => {
    const provider = makeProvider()

    for await (const _ of provider.generate([], 'test', { vercelAiSdk: { modelId: 'claude-3-7' } as any })) {
      // drain
    }

    expect(mockCreateModelFromConfig).toHaveBeenCalledWith({ modelId: 'claude-3-7' })
  })
})

// ==================== generate() — events ====================

describe('VercelAIProvider — generate() events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateModelFromConfig.mockResolvedValue({ model: {} as any, key: 'gpt-4o' })
  })

  it('yields done event with text from result', async () => {
    mockGenerateText.mockResolvedValue({ text: 'final answer', steps: [] } as any)
    const provider = makeProvider()

    const events = []
    for await (const e of provider.generate([], 'test')) {
      events.push(e)
    }

    const done = events.find((e) => e.type === 'done')
    expect(done?.result.text).toBe('final answer')
  })

  it('propagates error through channel', async () => {
    mockGenerateText.mockRejectedValue(new Error('model error'))
    const provider = makeProvider()

    await expect(async () => {
      for await (const _ of provider.generate([], 'test')) {
        // drain
      }
    }).rejects.toThrow('model error')
  })

  it('uses per-channel systemPrompt override', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok', steps: [] } as any)
    const provider = makeProvider()

    for await (const _ of provider.generate([], 'test', { systemPrompt: 'custom prompt' })) {
      // drain
    }

    const call = mockGenerateText.mock.calls[0][0]
    expect(call.system).toBe('custom prompt')
  })
})
