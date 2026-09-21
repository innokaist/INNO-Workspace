const HANDOFF_TOOL={
 name:'handoff_task',description:'Sequentially hand off to the other subscription provider, with no source attachments and at most two transitions. Save generated progress, then stop writing under the old lease.',
 inputSchema:{type:'object',required:['taskId','executionId','generation','content','handoff'],additionalProperties:false,properties:{
  taskId:{type:'string'},executionId:{type:'string'},generation:{type:'integer'},content:{type:'string',maxLength:12000},
  handoff:{type:'object',required:['provider','instructions','reason','acceptance'],additionalProperties:false,properties:{provider:{enum:['codex','claude']},instructions:{type:'string',maxLength:12000},reason:{type:'string',maxLength:1000},acceptance:{type:'string',maxLength:2000}}}
 }}
};
const TOOLS = Object.freeze([
  {
    name: 'list_tasks',
    description: 'List durable INNO Workspace tasks. Source attachment bytes are never returned.',
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  },
  {
    name: 'read_task',
    description: 'Read one durable task by ID.',
    inputSchema: {
      type: 'object', required: ['taskId'], additionalProperties: false,
      properties: {taskId: {type: 'string'}},
    },
  },
  {
    name: 'claim_execution',
    description: 'Acquire the single durable execution lease for a task.',
    inputSchema: {
      type: 'object', required: ['taskId', 'provider', 'expectedVersion'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, provider: {enum: ['codex', 'claude']},
        expectedVersion: {type: 'integer'}, leaseMs: {type: 'integer', minimum: 1000, maximum: 3600000},
      },
    },
  },
  {
    name: 'checkpoint_task',
    description: 'Write a checkpoint while holding the current execution ID and generation. Set status completed only after producing and verifying the result.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'content'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, content: {type: 'string'},
        status: {enum: ['running', 'completed']}, summary: {type: 'string'},
      },
    },
  },
  {
    name: 'artifact_task',
    description: 'Store a generated artifact while holding the current execution ID and generation. Inline artifact JSON is limited to 500,000 UTF-8 bytes (about 375 KB raw when base64 encoded).',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'artifact'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'},
        artifact: {
          type: 'object', required: ['name', 'mime', 'content'], additionalProperties: false,
          properties: {
            name: {type: 'string'}, mime: {type: 'string'}, content: {type: 'string'}, encoding: {enum: ['utf-8', 'base64']},
          },
        },
      },
    },
  },
  {
    name: 'plan_task',
    description: 'Replace the bounded role plan while holding the current execution ID and generation.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'plan'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, plan: {type: 'array', maxItems: 6},
      },
    },
  },
  {
    name: 'request_decision',
    description: 'Pause the current execution and request a user decision with 2 to 5 explicit options and their tradeoffs.',
    inputSchema: {
      type: 'object', required: ['taskId', 'executionId', 'generation', 'prompt', 'options'], additionalProperties: false,
      properties: {
        taskId: {type: 'string'}, executionId: {type: 'string'}, generation: {type: 'integer'}, prompt: {type: 'string'},
        options: {
          type: 'array', minItems: 2, maxItems: 5,
          items: {
            type: 'object', required: ['label', 'pros', 'cons'], additionalProperties: false,
            properties: {label: {type: 'string'}, pros: {type: 'string'}, cons: {type: 'string'}},
          },
        },
      },
    },
  },
]);

function toolResult(value) {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

async function callTool(store, name, args = {}, handlers = {}) {
  switch (name) {
    case 'handoff_task':
      if(!handlers.handoff)throw new Error('Provider handoff is unavailable in this environment');
      return toolResult({task:await handlers.handoff(args)});
    case 'list_tasks':
      return toolResult({tasks: await store.listTasks()});
    case 'read_task': {
      const task = await store.requireTask(args.taskId);
      return toolResult({task});
    }
    case 'claim_execution':
      return toolResult(await store.claimExecution(args.taskId, args));
    case 'checkpoint_task': {
      if (args.status === 'completed') {
        const task = await store.finishExecution(args.taskId, {
          executionId: args.executionId,
          generation: args.generation,
          content: args.summary || args.content,
          checkpoint: args.content,
        });
        return toolResult({task});
      }
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'checkpoint'});
      return toolResult({task});
    }
    case 'artifact_task': {
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'artifact'});
      return toolResult({task});
    }
    case 'plan_task': {
      const task = await store.applyExecutionAction(args.taskId, {...args, action: 'plan'});
      return toolResult({task});
    }
    case 'request_decision': {
      const task = await store.requestDecision(args.taskId, args);
      return toolResult({task});
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function handleMcp(store, message, handlers = {}) {
  const id = message?.id ?? null;
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return {jsonrpc: '2.0', id, error: {code: -32600, message: 'Invalid Request'}};
  }
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'inno-workspace', version: '0.1.0'},
      },
    };
  }
  if (message.method === 'ping') return {jsonrpc: '2.0', id, result: {}};
  if (message.method === 'tools/list') return {jsonrpc:'2.0',id,result:{tools:handlers.handoff?[...TOOLS,HANDOFF_TOOL]:TOOLS}};
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(store, message.params?.name, message.params?.arguments ?? {}, handlers);
      return {jsonrpc: '2.0', id, result};
    } catch (error) {
      return {
        jsonrpc: '2.0', id,
        result: {
          isError: true,
          content: [{type: 'text', text: error instanceof Error ? error.message : String(error)}],
        },
      };
    }
  }
  return {jsonrpc: '2.0', id, error: {code: -32601, message: 'Method not found'}};
}
