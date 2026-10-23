import assert from 'node:assert/strict';
import { FluidSimulation } from '../src/physics-core.js';
import { LiquidSurface } from '../src/surface-core.js';

const surface = new LiquidSurface();
for (const [count, preset, quality] of [[1800,'orbit','balanced'],[3600,'cascade','high'],[32000,'rain','ultra']]) {
  const fluid=new FluidSimulation({count,preset});
  const mesh=surface.reconstruct(fluid.positions,count,fluid.renderRadius,quality,.78);
  assert.ok(mesh.vertices>300,'a real triangle surface is reconstructed');
  assert.equal(mesh.vertices%3,0,'triangles contain complete vertices');
  assert.ok(mesh.vertices<300000,'surface stays inside the mesh capacity');
  assert.equal(mesh.positions.length,mesh.normals.length,'each vertex has a normal');
  for(let i=0;i<mesh.positions.length;i+=3){
    const x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2];
    assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z),'surface coordinates are finite');
    assert.ok(Math.abs(x)<2.05&&y>=0&&y<3.76&&Math.abs(z)<2.05,'surface stays in reconstruction domain');
    const n=Math.hypot(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2]);
    assert.ok(Number.isFinite(n)&&n>1e-6,'surface normals remain well-defined');
  }
  console.log(`${preset}: ${count.toLocaleString()} particles / ${quality} / ${mesh.vertices.toLocaleString()} vertices passed.`);
}
