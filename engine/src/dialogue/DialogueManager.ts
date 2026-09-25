export type DialogueNodeType = 'text' | 'choice' | 'condition' | 'action' | 'end';

export interface DialogueChoice {
  id: string;
  text: string;
  nextNodeId: string;
  conditionVariable?: string;
  /** Comparison operator applied to conditionVariable vs conditionValue. Default: '=='. */
  conditionOperator?: '==' | '!=' | '>' | '<' | '>=' | '<=';
  conditionValue?: unknown;
}

export interface DialogueCondition {
  variable: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
  value: unknown;
  onTrueNodeId: string;
  onFalseNodeId?: string;
}

export interface DialogueActionPayload {
  setVariables?: Record<string, unknown>;
  emitEvent?: {
    eventName: string;
    payload?: unknown;
  };
  nextNodeId?: string;
}

export interface DialogueNode {
  id: string;
  type: DialogueNodeType;
  speaker?: string;
  text?: string;
  choices?: DialogueChoice[];
  condition?: DialogueCondition;
  action?: DialogueActionPayload;
  nextNodeId?: string;
}

export interface DialogueTree {
  id: string;
  title: string;
  startNodeId: string;
  nodes: Record<string, DialogueNode>;
}

export type DialogueEventListener = (eventName: string, payload?: unknown) => void;

/**
 * DialogueManager — narrative branching graph engine inspired by Dialogic & Godot Dialogue Manager.
 *
 * Supports:
 * 1. Node-based narrative branching graphs (JSON AST)
 * 2. Dialogue state variables (quest flags, inventory, character affinity)
 * 3. Conditional branches and dynamic choices
 * 4. Action triggers directly emitting events into EventSheets / game systems
 * 5. Lightweight script DSL parsing for rapid agent/LLM generation
 */
export class DialogueManager {
  private trees: Map<string, DialogueTree> = new Map();
  private variables: Map<string, unknown> = new Map();
  private listeners: Set<DialogueEventListener> = new Set();

  private activeTreeId: string | null = null;
  private currentNodeId: string | null = null;

  public registerTree(tree: DialogueTree): void {
    if (!tree.id || !tree.startNodeId || !tree.nodes) {
      throw new Error('DialogueTree requires id, startNodeId, and nodes dictionary');
    }
    this.trees.set(tree.id, tree);
  }

  public getTree(id: string): DialogueTree | undefined {
    return this.trees.get(id);
  }

  public setVariable(name: string, value: unknown): void {
    this.variables.set(name, value);
  }

  public getVariable<T = unknown>(name: string, defaultValue?: T): T {
    if (this.variables.has(name)) {
      return this.variables.get(name) as T;
    }
    return defaultValue as T;
  }

  public addEventListener(listener: DialogueEventListener): void {
    this.listeners.add(listener);
  }

  public removeEventListener(listener: DialogueEventListener): void {
    this.listeners.delete(listener);
  }

  public startConversation(treeId: string): DialogueNode | null {
    const tree = this.trees.get(treeId);
    if (!tree) {
      throw new Error(`Dialogue tree "${treeId}" not found`);
    }

    this.activeTreeId = treeId;
    return this.stepToNode(tree.startNodeId);
  }

  public getCurrentNode(): DialogueNode | null {
    if (!this.activeTreeId || !this.currentNodeId) return null;
    const tree = this.trees.get(this.activeTreeId);
    return tree?.nodes[this.currentNodeId] || null;
  }

  public advance(): DialogueNode | null {
    const current = this.getCurrentNode();
    if (!current) return null;

    if (current.type === 'text') {
      if (!current.nextNodeId) {
        this.endConversation();
        return null;
      }
      return this.stepToNode(current.nextNodeId);
    }

    if (current.type === 'end') {
      this.endConversation();
      return null;
    }

    return current;
  }

  public chooseOption(choiceIndex: number): DialogueNode | null {
    const current = this.getCurrentNode();
    if (!current || current.type !== 'choice' || !current.choices) {
      throw new Error('Cannot choose option: current node is not a choice node');
    }

    const choice = current.choices[choiceIndex];
    if (!choice) {
      throw new Error(`Invalid choice index ${choiceIndex}`);
    }
    if (!this.isChoiceAvailable(choice)) {
      throw new Error(`Choice "${choice.id}" is not available under the current variables`);
    }

    return this.stepToNode(choice.nextNodeId);
  }

  /**
   * Returns the currently selectable choices (with their original indices in
   * the node's `choices` array) filtered by each choice's conditionVariable /
   * conditionValue against the live variable table.
   */
  public getAvailableChoices(): Array<{ index: number; choice: DialogueChoice }> {
    const current = this.getCurrentNode();
    if (!current || current.type !== 'choice' || !current.choices) return [];
    return current.choices
      .map((choice, index) => ({ index, choice }))
      .filter(({ choice }) => this.isChoiceAvailable(choice));
  }

  private isChoiceAvailable(choice: DialogueChoice): boolean {
    if (!choice.conditionVariable) return true;
    const value = this.variables.get(choice.conditionVariable);
    const target = choice.conditionValue;
    if (target === undefined) return value !== undefined;

    const op = choice.conditionOperator || '==';
    const a = Number(value);
    const b = Number(target);
    const numeric = Number.isFinite(a) && Number.isFinite(b);
    const looseEqual = value === target || String(value) === String(target);

    switch (op) {
      case '==':
        return looseEqual;
      case '!=':
        return !looseEqual;
      case '>':
        return numeric && a > b;
      case '<':
        return numeric && a < b;
      case '>=':
        return numeric && a >= b;
      case '<=':
        return numeric && a <= b;
      default:
        return false;
    }
  }

  public endConversation(): void {
    this.activeTreeId = null;
    this.currentNodeId = null;
  }

  private stepToNode(nodeId: string): DialogueNode | null {
    if (!this.activeTreeId) return null;
    const tree = this.trees.get(this.activeTreeId);
    if (!tree) return null;

    const node = tree.nodes[nodeId];
    if (!node) {
      this.endConversation();
      return null;
    }

    this.currentNodeId = node.id;

    if (node.type === 'end') {
      this.endConversation();
      return null;
    }

    // Handle condition nodes automatically
    if (node.type === 'condition' && node.condition) {
      const cond = node.condition;
      const val = this.getVariable(cond.variable);
      let passed = false;

      switch (cond.operator) {
        case '==': passed = val === cond.value; break;
        case '!=': passed = val !== cond.value; break;
        case '>': passed = Number(val) > Number(cond.value); break;
        case '<': passed = Number(val) < Number(cond.value); break;
        case '>=': passed = Number(val) >= Number(cond.value); break;
        case '<=': passed = Number(val) <= Number(cond.value); break;
      }

      const nextId = passed ? cond.onTrueNodeId : (cond.onFalseNodeId || '');
      if (nextId) return this.stepToNode(nextId);
      this.endConversation();
      return null;
    }

    // Handle action nodes automatically
    if (node.type === 'action' && node.action) {
      const act = node.action;
      if (act.setVariables) {
        for (const [k, v] of Object.entries(act.setVariables)) {
          this.setVariable(k, v);
        }
      }

      if (act.emitEvent) {
        for (const listener of this.listeners) {
          try {
            listener(act.emitEvent.eventName, act.emitEvent.payload);
          } catch (err) {
            console.error('Error in DialogueEventListener:', err);
          }
        }
      }

      if (act.nextNodeId) {
        return this.stepToNode(act.nextNodeId);
      }
      this.endConversation();
      return null;
    }

    return node;
  }

  /**
   * Parses a clean, human-readable script DSL into an executable DialogueTree AST.
   * Format example:
   * [Tree: ElderQuest]
   * Elder: Hello traveler.
   * - "I am ready." -> Accept
   * - "Not yet." -> Decline
   *
   * [Node: Accept]
   * Elder: May the gods guide you.
   * -> End
   */
  public parseScript(script: string): DialogueTree {
    const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
    let treeId = 'ParsedTree';
    let treeTitle = 'Parsed Tree';
    let startNodeId = 'start';
    const nodes: Record<string, DialogueNode> = {};

    let currentNode: DialogueNode | null = null;
    let nodeIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match [Tree: ID] or [Tree: ID (Title)]
      const treeMatch = line.match(/^\[Tree:\s*([a-zA-Z0-9_-]+)(?:\s*\((.*?)\))?\]$/);
      if (treeMatch) {
        treeId = treeMatch[1];
        treeTitle = treeMatch[2] || treeId;
        continue;
      }

      // Match [Node: ID]
      const nodeMatch = line.match(/^\[Node:\s*([a-zA-Z0-9_-]+)\]$/);
      if (nodeMatch) {
        if (currentNode) nodes[currentNode.id] = currentNode;
        currentNode = {
          id: nodeMatch[1],
          type: 'text',
          choices: []
        };
        if (Object.keys(nodes).length === 0 && !treeMatch) {
          startNodeId = currentNode.id;
        }
        continue;
      }

      // If no node header yet, initialize start node
      if (!currentNode) {
        currentNode = {
          id: `node_${nodeIndex++}`,
          type: 'text',
          choices: []
        };
        startNodeId = currentNode.id;
      }

      // Match choice: - "Option Text" -> NextNodeId
      const choiceMatch = line.match(/^-\s*"(.*?)"\s*->\s*([a-zA-Z0-9_-]+)$/);
      if (choiceMatch) {
        currentNode.type = 'choice';
        if (!currentNode.choices) currentNode.choices = [];
        currentNode.choices.push({
          id: `c_${currentNode.choices.length}`,
          text: choiceMatch[1],
          nextNodeId: choiceMatch[2]
        });
        continue;
      }

      // Match jump: -> NextNodeId
      const jumpMatch = line.match(/^->\s*([a-zA-Z0-9_-]+)$/);
      if (jumpMatch) {
        currentNode.nextNodeId = jumpMatch[1];
        continue;
      }

      // Match speaker & dialogue line: Speaker: Dialogue text
      const speakerMatch = line.match(/^([a-zA-Z0-9_\s]+):\s*(.*)$/);
      if (speakerMatch) {
        currentNode.speaker = speakerMatch[1].trim();
        currentNode.text = speakerMatch[2].trim();
        continue;
      }

      // Match plain text
      if (!currentNode.text) {
        currentNode.text = line;
      } else {
        currentNode.text += ' ' + line;
      }
    }

    if (currentNode) {
      nodes[currentNode.id] = currentNode;
    }

    const tree: DialogueTree = {
      id: treeId,
      title: treeTitle,
      startNodeId: nodes[startNodeId] ? startNodeId : Object.keys(nodes)[0] || 'start',
      nodes
    };

    this.registerTree(tree);
    return tree;
  }
}
