import { openDb } from '../src/core/db.js';
import { Store } from '../src/core/store.js';

export const memStore = () => new Store(openDb(':memory:'));

/** Understanding Agents: Agent → Model | Tool | Memory | Environment */
export function agentsMap(store: Store) {
  const map = store.createMap({ title: 'Understanding Agents' });
  const agent = store.createNode(map.id, { title: 'Agent' }).node;
  const kid = (title: string, extra = {}) => store.createNode(map.id, { title, parent_id: agent.id, ...extra }).node;
  const model = kid('Model');
  const tool = kid('Tool');
  const memory = kid('Memory', {
    summary: 'Persistent info beyond the context window.',
    notes: 'Notes about memory.',
    tags: ['core'],
    questions: ['What to forget?'],
  });
  const env = kid('Environment');
  return { map, agent, model, tool, memory, env };
}
