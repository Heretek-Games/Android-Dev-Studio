import React, { useState } from 'react';
import { useStudio } from '../state/StudioState';
import {
  MeshRenderer,
  LightComponent,
  CameraComponent,
  RigidBody3D,
  Collider3D,
  MobileController,
  EventSheet,
  ElementalReactionComponent,
  AnimeCelShader,
  type ElementType
} from '@heretek/engine';
import {
  Sliders,
  Box,
  Sun,
  Shield,
  Zap,
  Activity,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Flame,
  Droplet,
  Snowflake,
  Wind,
  ShieldAlert,
  Sparkles,
  Layers,
  Compass
} from 'lucide-react';

interface AccordionCardProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  isOpen: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

const AccordionCard: React.FC<AccordionCardProps> = ({
  title,
  icon: Icon,
  colorClass,
  isOpen,
  onToggle,
  onRemove,
  badge,
  children
}) => {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-lg overflow-hidden transition-all shadow-sm">
      {/* Header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between px-3 py-2 bg-zinc-900/90 hover:bg-zinc-800/60 cursor-pointer border-b border-zinc-800/40 transition-colors"
      >
        <div className="flex items-center space-x-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          )}
          <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${colorClass}`}>
            {title}
          </span>
        </div>

        <div className="flex items-center space-x-1.5" onClick={e => e.stopPropagation()}>
          {badge}
          {onRemove && (
            <button
              onClick={onRemove}
              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1"
              title="Remove Component"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {isOpen && <div className="p-3 space-y-2.5">{children}</div>}
    </div>
  );
};

export const Inspector: React.FC = () => {
  const { selectedGameObject, refreshScene } = useStudio();
  const [showAddComponent, setShowAddComponent] = useState(false);
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({
    transform: true,
    mesh: true,
    rigidBody: false,
    controller: false,
    elemental: true,
    celShader: false,
    light: true
  });

  const toggleCard = (key: string) => {
    setOpenCards(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!selectedGameObject) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-zinc-500 text-xs bg-zinc-950 border-l border-zinc-800">
        <Sliders className="w-8 h-8 mb-2 opacity-30 text-zinc-400" />
        <span className="font-medium text-zinc-400">No Entity Selected</span>
        <span className="text-[11px] text-zinc-600 mt-1 max-w-[200px]">
          Click an object in the Scene Hierarchy or 3D Viewport to inspect and edit components.
        </span>
      </div>
    );
  }

  const go = selectedGameObject;
  const t = go.transform;

  const updatePos = (axis: 'x' | 'y' | 'z', val: number) => {
    t.position[axis] = val;
    t.updateMatrices();
    refreshScene();
  };

  const updateRot = (axis: 'x' | 'y' | 'z', deg: number) => {
    t.rotation[axis] = (deg * Math.PI) / 180;
    t.updateMatrices();
    refreshScene();
  };

  const updateScale = (axis: 'x' | 'y' | 'z', val: number) => {
    t.scale[axis] = val;
    t.updateMatrices();
    refreshScene();
  };

  // Component Finders
  const meshRenderer = go.getComponent(MeshRenderer);
  const lightComp = go.getComponent(LightComponent);
  const rigidBody = go.getComponent(RigidBody3D);
  const collider = go.getComponent(Collider3D);
  const mobileController = go.getComponent(MobileController);
  const eventSheet = go.getComponent(EventSheet);
  const elementalComp = go.getComponent(ElementalReactionComponent);
  const celShader = go.getComponent(AnimeCelShader);

  return (
    <div className="flex flex-col h-full bg-zinc-950 select-none border-l border-zinc-800 overflow-y-auto">
      {/* Top Entity Details Header */}
      <div className="p-3 border-b border-zinc-800 bg-zinc-900/50 space-y-2">
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={go.active}
            onChange={(e) => { go.active = e.target.checked; refreshScene(); }}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-blue-600 focus:ring-0 cursor-pointer"
            title="Toggle Entity Active"
          />
          <input
            type="text"
            value={go.name}
            onChange={(e) => { go.name = e.target.value; refreshScene(); }}
            className="flex-1 bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-xs text-white font-medium focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center space-x-2 text-[10px] text-zinc-400 font-mono">
          <span className="bg-zinc-850 px-2 py-0.5 rounded border border-zinc-800 text-zinc-300">
            Tag: {go.tag}
          </span>
          <span className="bg-zinc-850 px-2 py-0.5 rounded border border-zinc-800 text-zinc-500 truncate max-w-[120px]">
            ID: {go.id}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-2.5">
        {/* 1. Transform Component (Always Present) */}
        <AccordionCard
          title="Transform"
          icon={Compass}
          colorClass="text-blue-400"
          isOpen={openCards.transform}
          onToggle={() => toggleCard('transform')}
          badge={
            <span className="font-mono text-[10px] text-zinc-500">
              ({t.position.x.toFixed(1)}, {t.position.y.toFixed(1)}, {t.position.z.toFixed(1)})
            </span>
          }
        >
          {/* Position */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Position</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-950 rounded border border-zinc-800 px-1.5 py-0.5 focus-within:border-blue-500">
                  <span className={`text-[10px] font-bold mr-1 font-mono ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={Math.round(t.position[axis] * 100) / 100}
                    onChange={(e) => updatePos(axis, parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Rotation */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Rotation (Deg)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-950 rounded border border-zinc-800 px-1.5 py-0.5 focus-within:border-blue-500">
                  <span className={`text-[10px] font-bold mr-1 font-mono ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="5"
                    value={Math.round((t.rotation[axis] * 180) / Math.PI)}
                    onChange={(e) => updateRot(axis, parseFloat(e.target.value) || 0)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Scale</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['x', 'y', 'z'] as const).map(axis => (
                <div key={axis} className="flex items-center bg-zinc-950 rounded border border-zinc-800 px-1.5 py-0.5 focus-within:border-blue-500">
                  <span className={`text-[10px] font-bold mr-1 font-mono ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-emerald-400' : 'text-blue-400'}`}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={Math.round(t.scale[axis] * 100) / 100}
                    onChange={(e) => updateScale(axis, parseFloat(e.target.value) || 1)}
                    className="w-full bg-transparent text-xs text-right text-white outline-none font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        </AccordionCard>

        {/* 2. Mesh Renderer Component */}
        {meshRenderer && (
          <AccordionCard
            title="Mesh Renderer"
            icon={Box}
            colorClass="text-emerald-400"
            isOpen={openCards.mesh}
            onToggle={() => toggleCard('mesh')}
            onRemove={() => { go.removeComponent(meshRenderer); refreshScene(); }}
            badge={
              <span className="font-mono text-[10px] uppercase bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 border border-zinc-700">
                {meshRenderer.shape}
              </span>
            }
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Color Material</span>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="color"
                    value={meshRenderer.color}
                    onChange={(e) => { meshRenderer.setMaterial(e.target.value); refreshScene(); }}
                    className="w-6 h-6 rounded cursor-pointer border border-zinc-700 bg-transparent"
                  />
                  <span className="font-mono text-[11px] text-zinc-300">{meshRenderer.color}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Roughness</span>
                  <span className="font-mono text-zinc-200">{meshRenderer.roughness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={meshRenderer.roughness}
                  onChange={(e) => { meshRenderer.setMaterial(undefined, parseFloat(e.target.value)); refreshScene(); }}
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Metalness</span>
                  <span className="font-mono text-zinc-200">{meshRenderer.metalness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={meshRenderer.metalness}
                  onChange={(e) => { meshRenderer.setMaterial(undefined, undefined, parseFloat(e.target.value)); refreshScene(); }}
                  className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded"
                />
              </div>
            </div>
          </AccordionCard>
        )}

        {/* 3. Light Component */}
        {lightComp && (
          <AccordionCard
            title="Light"
            icon={Sun}
            colorClass="text-amber-400"
            isOpen={openCards.light}
            onToggle={() => toggleCard('light')}
            onRemove={() => { go.removeComponent(lightComp); refreshScene(); }}
            badge={
              <span className="font-mono text-[10px] text-amber-300 capitalize bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                {lightComp.lightType} ({lightComp.intensity})
              </span>
            }
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Type</span>
                <span className="capitalize text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
                  {lightComp.lightType}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Intensity</span>
                  <span className="font-mono text-zinc-200">{lightComp.intensity}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.2"
                  value={lightComp.intensity}
                  onChange={(e) => {
                    lightComp.intensity = parseFloat(e.target.value);
                    if (lightComp.threeLight) lightComp.threeLight.intensity = lightComp.intensity;
                    refreshScene();
                  }}
                  className="w-full accent-amber-500 cursor-pointer h-1.5 bg-zinc-800 rounded"
                />
              </div>
            </div>
          </AccordionCard>
        )}

        {/* 4. RigidBody 3D (Rapier Physics) */}
        {rigidBody && (
          <AccordionCard
            title="RigidBody 3D"
            icon={Activity}
            colorClass="text-purple-400"
            isOpen={openCards.rigidBody}
            onToggle={() => toggleCard('rigidBody')}
            onRemove={() => { go.removeComponent(rigidBody); refreshScene(); }}
            badge={
              <span className="font-mono text-[10px] uppercase bg-purple-950/60 text-purple-300 px-1.5 py-0.5 rounded border border-purple-800/40">
                {rigidBody.bodyType}
              </span>
            }
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Body Type</span>
                <select
                  value={rigidBody.bodyType}
                  onChange={(e) => { rigidBody.bodyType = e.target.value as any; refreshScene(); }}
                  className="bg-zinc-850 text-zinc-200 border border-zinc-700 rounded px-2 py-0.5 outline-none cursor-pointer"
                >
                  <option value="dynamic">Dynamic (Affected by Gravity)</option>
                  <option value="fixed">Fixed (Static Ground/Wall)</option>
                  <option value="kinematic">Kinematic (Code Driven)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Mass (kg)</span>
                <input
                  type="number"
                  step="0.5"
                  value={rigidBody.mass}
                  onChange={(e) => { rigidBody.mass = parseFloat(e.target.value) || 1; refreshScene(); }}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
                />
              </div>
            </div>
          </AccordionCard>
        )}

        {/* 5. Mobile Controller */}
        {mobileController && (
          <AccordionCard
            title="Mobile Controller"
            icon={Zap}
            colorClass="text-cyan-400"
            isOpen={openCards.controller}
            onToggle={() => toggleCard('controller')}
            onRemove={() => { go.removeComponent(mobileController); refreshScene(); }}
            badge={
              <span className="font-mono text-[10px] text-cyan-300">
                spd: {mobileController.moveSpeed}
              </span>
            }
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Move Speed</span>
                <input
                  type="number"
                  step="0.5"
                  value={mobileController.moveSpeed}
                  onChange={(e) => { mobileController.moveSpeed = parseFloat(e.target.value) || 5; refreshScene(); }}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Jump Force</span>
                <input
                  type="number"
                  step="0.5"
                  value={mobileController.jumpForce}
                  onChange={(e) => { mobileController.jumpForce = parseFloat(e.target.value) || 5; refreshScene(); }}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-right text-white outline-none font-mono"
                />
              </div>
            </div>
          </AccordionCard>
        )}

        {/* 6. Elemental Combat Reaction Component */}
        {elementalComp && (
          <AccordionCard
            title="Elemental Combat"
            icon={Flame}
            colorClass="text-rose-400"
            isOpen={openCards.elemental}
            onToggle={() => toggleCard('elemental')}
            onRemove={() => { go.removeComponent(elementalComp); refreshScene(); }}
            badge={
              elementalComp.currentAura ? (
                <span className="font-mono text-[10px] font-bold text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                  {elementalComp.currentAura.element} ({elementalComp.currentAura.gaugeUnits.toFixed(1)}U)
                </span>
              ) : (
                <span className="font-mono text-[10px] text-zinc-500">Clean</span>
              )
            }
          >
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Status</span>
                <span className={`text-[11px] font-mono font-medium ${elementalComp.isFrozen ? 'text-cyan-300 animate-pulse font-bold' : 'text-emerald-400'}`}>
                  {elementalComp.isFrozen ? `FROZEN (${elementalComp.freezeTimer.toFixed(1)}s)` : 'ACTIVE'}
                </span>
              </div>

              {elementalComp.lastReaction && (
                <div className="p-1.5 rounded bg-zinc-950 border border-zinc-800 flex items-center justify-between font-mono text-[10px]">
                  <span className="text-zinc-400">Last Reaction:</span>
                  <span className="text-amber-300 font-bold">
                    {elementalComp.lastReaction.reaction} (×{elementalComp.lastReaction.damageMultiplier.toFixed(1)})
                  </span>
                </div>
              )}

              {/* Elemental Attack Trigger Buttons */}
              <div className="pt-1">
                <span className="text-[10px] text-zinc-400 block mb-1.5">Apply Elemental Attack (Genshin Engine):</span>
                <div className="grid grid-cols-5 gap-1">
                  {(['Pyro', 'Hydro', 'Cryo', 'Electro', 'Anemo'] as ElementType[]).map((elem) => (
                    <button
                      key={elem}
                      onClick={() => {
                        elementalComp.receiveElementalAttack(elem, 50, 1.0);
                        refreshScene();
                      }}
                      className={`py-1 rounded text-[10px] font-bold border transition-all active:scale-95 ${
                        elem === 'Pyro'
                          ? 'bg-rose-900/50 hover:bg-rose-800/60 border-rose-500/50 text-rose-300'
                          : elem === 'Hydro'
                          ? 'bg-blue-900/50 hover:bg-blue-800/60 border-blue-500/50 text-blue-300'
                          : elem === 'Cryo'
                          ? 'bg-cyan-900/50 hover:bg-cyan-800/60 border-cyan-500/50 text-cyan-300'
                          : elem === 'Electro'
                          ? 'bg-purple-900/50 hover:bg-purple-800/60 border-purple-500/50 text-purple-300'
                          : 'bg-emerald-900/50 hover:bg-emerald-800/60 border-emerald-500/50 text-emerald-300'
                      }`}
                    >
                      {elem}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </AccordionCard>
        )}

        {/* 7. Anime Cel Shader Component */}
        {celShader && (
          <AccordionCard
            title="Anime Cel-Shader"
            icon={Sparkles}
            colorClass="text-sky-400"
            isOpen={openCards.celShader}
            onToggle={() => toggleCard('celShader')}
            onRemove={() => { go.removeComponent(celShader); refreshScene(); }}
            badge={
              <span className="font-mono text-[10px] text-sky-300">
                rim: {celShader.rimPower.toFixed(1)}
              </span>
            }
          >
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Rim Power</span>
                <span className="font-mono text-zinc-200">{celShader.rimPower.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={celShader.rimPower}
                onChange={(e) => { celShader.rimPower = Number(e.target.value); refreshScene(); }}
                className="w-full accent-sky-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />
            </div>
          </AccordionCard>
        )}

        {/* Add Component Button */}
        <div className="relative pt-2">
          <button
            onClick={() => setShowAddComponent(!showAddComponent)}
            className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-medium border border-zinc-800 hover:border-zinc-700 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-blue-400" />
            <span>Add Component</span>
          </button>

          {showAddComponent && (
            <div
              className="absolute left-0 right-0 bottom-11 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-1 z-50 text-xs space-y-0.5"
              onMouseLeave={() => setShowAddComponent(false)}
            >
              {!meshRenderer && (
                <button
                  onClick={() => { go.addComponent(new MeshRenderer({ shape: 'box' })); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Box className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Mesh Renderer</span>
                </button>
              )}
              {!rigidBody && (
                <button
                  onClick={() => { go.addComponent(new RigidBody3D({ bodyType: 'dynamic' })); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Activity className="w-3.5 h-3.5 text-purple-400" />
                  <span>RigidBody 3D (Physics)</span>
                </button>
              )}
              {!mobileController && (
                <button
                  onClick={() => { go.addComponent(new MobileController()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Mobile Joystick Controller</span>
                </button>
              )}
              {!eventSheet && (
                <button
                  onClick={() => { go.addComponent(new EventSheet()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Visual Event Sheet</span>
                </button>
              )}
              {!elementalComp && (
                <button
                  onClick={() => { go.addComponent(new ElementalReactionComponent()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  <span>Genshin Elemental Combat</span>
                </button>
              )}
              {!celShader && (
                <button
                  onClick={() => { go.addComponent(new AnimeCelShader()); setShowAddComponent(false); refreshScene(); }}
                  className="w-full px-3 py-1.5 text-left rounded hover:bg-zinc-800 text-zinc-200 flex items-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Anime Cel-Shader</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
