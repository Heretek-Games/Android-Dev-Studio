import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import { EventSheet, VisualEvent, EventCondition, EventAction } from '@heretek/engine';
import {
  Zap,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Touchpad,
  Play,
  RotateCw,
  Move,
  Palette
} from 'lucide-react';

export const EventSheetEditor: React.FC = () => {
  const { selectedGameObject, refreshScene } = useStudio();
  const [showAddCondition, setShowAddCondition] = useState<string | null>(null);
  const [showAddAction, setShowAddAction] = useState<string | null>(null);

  if (!selectedGameObject) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-gray-500 text-xs bg-studio-surface">
        <Zap className="w-8 h-8 mb-2 opacity-40 text-gray-400" />
        <span>No Entity Selected</span>
        <span className="text-[11px] text-gray-600 mt-1">Select an object with an Event Sheet to view and edit its visual logic.</span>
      </div>
    );
  }

  let eventSheet = selectedGameObject.getComponent(EventSheet);

  const handleAddEventSheet = () => {
    eventSheet = selectedGameObject.addComponent(new EventSheet());
    refreshScene();
  };

  if (!eventSheet) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-gray-400 text-xs bg-studio-surface space-y-3">
        <Zap className="w-8 h-8 text-amber-400 opacity-60" />
        <span className="text-gray-300 font-medium">No Visual Event Sheet on {selectedGameObject.name}</span>
        <p className="text-[11px] text-gray-500 max-w-sm">
          Event sheets allow you to program 3D game logic visually using conditions and actions (GDevelop style) without writing code.
        </p>
        <button
          onClick={handleAddEventSheet}
          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-md transition-colors"
        >
          + Add Event Sheet Component
        </button>
      </div>
    );
  }

  const addNewEvent = () => {
    const newEv: VisualEvent = {
      id: 'ev_' + Math.random().toString(36).substring(2, 7),
      name: `Event #${eventSheet!.events.length + 1}`,
      enabled: true,
      conditions: [{ type: 'EveryFrame' }],
      actions: [{ type: 'RotateY', params: { speed: 1.5 } }]
    };
    eventSheet!.addEvent(newEv);
    refreshScene();
  };

  const addConditionToEvent = (evId: string, condType: EventCondition['type']) => {
    const ev = eventSheet!.events.find(e => e.id === evId);
    if (ev) {
      ev.conditions.push({ type: condType });
      refreshScene();
    }
    setShowAddCondition(null);
  };

  const addActionToEvent = (evId: string, actType: EventAction['type'], params: any = {}) => {
    const ev = eventSheet!.events.find(e => e.id === evId);
    if (ev) {
      ev.actions.push({ type: actType, params });
      refreshScene();
    }
    setShowAddAction(null);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 select-none overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-studio-border bg-studio-bg/60">
        <div className="flex items-center space-x-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-gray-200 uppercase tracking-wide">
            Visual Logic: {selectedGameObject.name}
          </span>
        </div>
        <button
          onClick={addNewEvent}
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Event</span>
        </button>
      </div>

      {/* Events Table / Sheet */}
      <div className="p-3 space-y-3 flex-1">
        {eventSheet.events.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-xs">
            No events yet. Click "+ New Event" to create condition-action logic blocks.
          </div>
        )}

        {eventSheet.events.map((ev, index) => (
          <div
            key={ev.id}
            className="bg-zinc-800/80 border border-studio-border rounded-lg overflow-hidden shadow-sm"
          >
            {/* Event Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-studio-border text-xs">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={ev.enabled}
                  onChange={(e) => { ev.enabled = e.target.checked; refreshScene(); }}
                  className="rounded border-studio-border text-blue-600 cursor-pointer"
                />
                <span className="font-semibold text-gray-300">{ev.name}</span>
              </div>
              <button
                onClick={() => { eventSheet!.removeEvent(ev.id); refreshScene(); }}
                className="text-gray-500 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Split Grid: Conditions (Left) and Actions (Right) */}
            <div className="grid grid-cols-2 divide-x divide-studio-border text-xs min-h-[90px]">
              {/* Conditions Column */}
              <div className="p-2.5 space-y-2 bg-zinc-900/40">
                <div className="flex items-center justify-between text-[11px] font-medium text-emerald-400">
                  <span>CONDITIONS (When...)</span>
                  <button
                    onClick={() => setShowAddCondition(ev.id)}
                    className="text-gray-400 hover:text-emerald-400 flex items-center space-x-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  {ev.conditions.map((cond, cIdx) => (
                    <div
                      key={cIdx}
                      className="flex items-center justify-between bg-zinc-800 px-2 py-1 rounded border border-studio-border/60 text-gray-200"
                    >
                      <div className="flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>{cond.type}</span>
                      </div>
                      <button
                        onClick={() => { ev.conditions.splice(cIdx, 1); refreshScene(); }}
                        className="text-gray-500 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Condition Dropdown */}
                {showAddCondition === ev.id && (
                  <div className="bg-zinc-800 border border-studio-border rounded shadow-lg p-1 space-y-0.5 text-[11px]">
                    <button
                      onClick={() => addConditionToEvent(ev.id, 'EveryFrame')}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      ⚡ Every Frame (Tick)
                    </button>
                    <button
                      onClick={() => addConditionToEvent(ev.id, 'OnStart')}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      ▶ On Scene Start
                    </button>
                    <button
                      onClick={() => addConditionToEvent(ev.id, 'OnButtonPress')}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      🎮 On Jump Button Pressed
                    </button>
                    <button
                      onClick={() => addConditionToEvent(ev.id, 'OnTouchTap')}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      👆 On Screen Tap
                    </button>
                  </div>
                )}
              </div>

              {/* Actions Column */}
              <div className="p-2.5 space-y-2 bg-zinc-900/20">
                <div className="flex items-center justify-between text-[11px] font-medium text-blue-400">
                  <span>ACTIONS (Do...)</span>
                  <button
                    onClick={() => setShowAddAction(ev.id)}
                    className="text-gray-400 hover:text-blue-400 flex items-center space-x-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  {ev.actions.map((act, aIdx) => (
                    <div
                      key={aIdx}
                      className="flex items-center justify-between bg-zinc-800 px-2 py-1 rounded border border-studio-border/60 text-gray-200"
                    >
                      <div className="flex items-center space-x-1.5">
                        {act.type === 'RotateY' && <RotateCw className="w-3 h-3 text-cyan-400" />}
                        {act.type === 'ApplyImpulse' && <Zap className="w-3 h-3 text-amber-400" />}
                        {act.type === 'Translate' && <Move className="w-3 h-3 text-indigo-400" />}
                        {act.type === 'SetColor' && <Palette className="w-3 h-3 text-pink-400" />}
                        <span>{act.type}</span>
                        {act.params?.speed && <span className="text-gray-400">({act.params.speed} rad/s)</span>}
                        {act.params?.y && <span className="text-gray-400">(y: {act.params.y})</span>}
                      </div>
                      <button
                        onClick={() => { ev.actions.splice(aIdx, 1); refreshScene(); }}
                        className="text-gray-500 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add Action Dropdown */}
                {showAddAction === ev.id && (
                  <div className="bg-zinc-800 border border-studio-border rounded shadow-lg p-1 space-y-0.5 text-[11px]">
                    <button
                      onClick={() => addActionToEvent(ev.id, 'RotateY', { speed: 2.0 })}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      🔄 Rotate Y (Continuous Spin)
                    </button>
                    <button
                      onClick={() => addActionToEvent(ev.id, 'ApplyImpulse', { x: 0, y: 6.0, z: 0 })}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      🚀 Apply Jump Impulse (Physics)
                    </button>
                    <button
                      onClick={() => addActionToEvent(ev.id, 'SetColor', { color: '#ec4899' })}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      🎨 Change Material Color
                    </button>
                    <button
                      onClick={() => addActionToEvent(ev.id, 'Translate', { x: 0, y: 0, z: 2.0, relativeToDelta: true })}
                      className="w-full text-left px-2 py-1 rounded hover:bg-studio-hover text-gray-200"
                    >
                      ➡️ Move Forward (+Z)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
