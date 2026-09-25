import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DialogueManager } from './DialogueManager.js';

describe('DialogueManager (Dialogic & Godot Dialogue Architecture)', () => {
  it('registers tree and advances linear text nodes', () => {
    const dm = new DialogueManager();
    dm.registerTree({
      id: 'greeting',
      title: 'Simple Greeting',
      startNodeId: 'node_1',
      nodes: {
        node_1: {
          id: 'node_1',
          type: 'text',
          speaker: 'Guard',
          text: 'Halt! Who goes there?',
          nextNodeId: 'node_2'
        },
        node_2: {
          id: 'node_2',
          type: 'text',
          speaker: 'Guard',
          text: 'Pass through, citizen.',
          nextNodeId: 'end_node'
        },
        end_node: {
          id: 'end_node',
          type: 'end'
        }
      }
    });

    const first = dm.startConversation('greeting');
    assert.strictEqual(first?.id, 'node_1');
    assert.strictEqual(first?.text, 'Halt! Who goes there?');

    const second = dm.advance();
    assert.strictEqual(second?.id, 'node_2');
    assert.strictEqual(second?.text, 'Pass through, citizen.');

    const third = dm.advance();
    assert.strictEqual(third, null); // reached end
  });

  it('evaluates choices and conditional branching', () => {
    const dm = new DialogueManager();
    dm.setVariable('has_pass', true);

    dm.registerTree({
      id: 'gate',
      title: 'Gate Check',
      startNodeId: 'check_pass',
      nodes: {
        check_pass: {
          id: 'check_pass',
          type: 'condition',
          condition: {
            variable: 'has_pass',
            operator: '==',
            value: true,
            onTrueNodeId: 'welcome_node',
            onFalseNodeId: 'deny_node'
          }
        },
        welcome_node: {
          id: 'welcome_node',
          type: 'text',
          speaker: 'Gatekeeper',
          text: 'Welcome, honored guest.'
        },
        deny_node: {
          id: 'deny_node',
          type: 'text',
          speaker: 'Gatekeeper',
          text: 'Begone! You have no pass.'
        }
      }
    });

    // With has_pass = true, branches directly to welcome_node
    const node = dm.startConversation('gate');
    assert.strictEqual(node?.id, 'welcome_node');
    assert.strictEqual(node?.text, 'Welcome, honored guest.');
  });

  it('triggers actions and dispatches event listeners', () => {
    const dm = new DialogueManager();
    let receivedName = '';

    dm.addEventListener((name) => {
      receivedName = name;
    });

    dm.registerTree({
      id: 'quest_trigger',
      title: 'Quest Offer',
      startNodeId: 'action_node',
      nodes: {
        action_node: {
          id: 'action_node',
          type: 'action',
          action: {
            setVariables: { quest_started: true },
            emitEvent: { eventName: 'StartBossFight', payload: { bossId: 'dragon_1' } },
            nextNodeId: 'boss_intro'
          }
        },
        boss_intro: {
          id: 'boss_intro',
          type: 'text',
          speaker: 'Elder',
          text: 'The beast has awakened!'
        }
      }
    });

    const node = dm.startConversation('quest_trigger');
    assert.strictEqual(node?.id, 'boss_intro');
    assert.strictEqual(dm.getVariable('quest_started'), true);
    assert.strictEqual(receivedName, 'StartBossFight');
  });

  it('parses lightweight script DSL into executable tree', () => {
    const dm = new DialogueManager();
    const script = `
      [Tree: InnkeeperChat (Innkeeper Conversation)]
      Innkeeper: Welcome to the Prancing Pony!
      - "Can I rent a room?" -> RoomNode
      - "Just looking." -> ByeNode

      [Node: RoomNode]
      Innkeeper: That will be 5 copper coins.
      -> EndNode

      [Node: ByeNode]
      Innkeeper: Suit yourself.
      -> EndNode

      [Node: EndNode]
    `;

    const tree = dm.parseScript(script);
    assert.strictEqual(tree.id, 'InnkeeperChat');
    assert.strictEqual(tree.title, 'Innkeeper Conversation');

    const first = dm.startConversation('InnkeeperChat');
    assert.strictEqual(first?.type, 'choice');
    assert.strictEqual(first?.choices?.length, 2);

    // Pick choice 0 ("Can I rent a room?")
    const next = dm.chooseOption(0);
    assert.strictEqual(next?.id, 'RoomNode');
    assert.strictEqual(next?.text, 'That will be 5 copper coins.');
  });

  it('filters choices by conditionVariable and blocks unavailable picks', () => {
    const dm = new DialogueManager();
    dm.registerTree({
      id: 'gated',
      title: 'Gated Choices',
      startNodeId: 'choice_node',
      nodes: {
        choice_node: {
          id: 'choice_node',
          type: 'choice',
          text: 'What will it be?',
          choices: [
            { id: 'buy', text: 'Buy the artifact', nextNodeId: 'bought', conditionVariable: 'gold', conditionOperator: '>=', conditionValue: 100 },
            { id: 'chat', text: 'Ask about the weather', nextNodeId: 'chatted' },
            { id: 'brag', text: 'Show off wealth', nextNodeId: 'bragged', conditionVariable: 'gold', conditionOperator: '>=', conditionValue: 500 }
          ]
        },
        bought: { id: 'bought', type: 'text', text: 'A fine purchase.', nextNodeId: 'end' },
        chatted: { id: 'chatted', type: 'text', text: 'Lovely day, isn\'t it?', nextNodeId: 'end' },
        bragged: { id: 'bragged', type: 'text', text: 'Impressive!', nextNodeId: 'end' },
        end: { id: 'end', type: 'end' }
      }
    });

    dm.setVariable('gold', 50);
    dm.startConversation('gated');
    let available = dm.getAvailableChoices();
    assert.deepStrictEqual(available.map(a => a.index), [1]);

    // Choice 0 (needs 100 gold) is unavailable at 50 gold; choice 1 is fine.
    assert.throws(() => dm.chooseOption(0), /not available/);
    assert.throws(() => dm.chooseOption(2), /not available/);
    const chatNext = dm.chooseOption(1);
    assert.strictEqual(chatNext?.id, 'chatted');

    // With 100 gold the purchase unlocks.
    dm.setVariable('gold', 100);
    dm.startConversation('gated');
    available = dm.getAvailableChoices();
    assert.deepStrictEqual(available.map(a => a.index), [0, 1]);
    const buyNext = dm.chooseOption(0);
    assert.strictEqual(buyNext?.id, 'bought');

    // At 750 gold every choice is selectable.
    dm.setVariable('gold', 750);
    dm.startConversation('gated');
    available = dm.getAvailableChoices();
    assert.deepStrictEqual(available.map(a => a.index), [0, 1, 2]);
  });
});
