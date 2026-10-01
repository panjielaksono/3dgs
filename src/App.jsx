import { useEffect, useRef, useState } from 'react';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import './App.css';

const genId = () => Math.random().toString(36).substr(2, 9);

function App() {
  const splatContainerRef = useRef(null);
  const editorContainerRef = useRef(null);
  
  const splatViewerRef = useRef(null);
  const editorRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    orbitControls: null,
    transformControls: null,
    models: [], 
    mixers: [],
    clock: new THREE.Clock(),
    animationId: null,
    fileUrls: {}
  });

  const [mode, setMode] = useState('splat'); // 'splat' or 'editor'
  const [loadingMsg, setLoadingMsg] = useState("Initializing Engine...");
  
  // Editor State
  const [models, setModels] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [transformMode, setTransformMode] = useState('translate');
  const [showProperties, setShowProperties] = useState(true);

  // Staging State
  const [stagingObjFile, setStagingObjFile] = useState(null);
  const [supportFiles, setSupportFiles] = useState([]);

  // ==========================================
  // SPLAT ENGINE
  // ==========================================
  const loadSplat = (file) => {
    setMode('splat');
    setLoadingMsg(`Processing Gaussian Splats (${file.name})...`);
    
    if (splatViewerRef.current) {
      try { splatViewerRef.current.dispose(); } catch(e){}
      splatContainerRef.current.innerHTML = '';
    }

    const viewer = new GaussianSplats3D.Viewer({
      rootElement: splatContainerRef.current,
      cameraUp: [0, 1, 0],
      initialCameraPosition: [-1, -1, -1],
      initialCameraLookAt: [0, 0, 0],
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
    });
    splatViewerRef.current = viewer;

    const url = URL.createObjectURL(file) + '#' + file.name;
    viewer.addSplatScene(url, { splatAlphaCrop: 0, showLoadingUI: true, format: 2 })
      .then(() => {
        setLoadingMsg("");
        viewer.start();
      })
      .catch(err => {
        console.error(err);
        setLoadingMsg("Error loading splat.");
      });
  };

  // ==========================================
  // THREE.JS EDITOR ENGINE
  // ==========================================
  const initEditor = () => {
    if (editorRef.current.renderer) return; // already init

    const container = editorContainerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    
    // Nice gradient background or keep transparent for CSS
    scene.background = null; 
    
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 5, 10);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Grid helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x888888);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // Controls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(1.5); // Make it larger and easier to see
    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
      if (!event.value) {
        // When drag ends, force React to sync UI sliders
        setModels([...editorRef.current.models]);
      }
    });
    transform.addEventListener('hoveron', () => {
      orbit.enabled = false;
    });
    transform.addEventListener('hoveroff', () => {
      orbit.enabled = true;
    });
    scene.add(transform.getHelper());

    const selectionBox = new THREE.BoxHelper(scene, 0xffde00);
    selectionBox.visible = false;
    scene.add(selectionBox);

    // Sync box helper while moving gizmo
    transform.addEventListener('change', () => {
      if (selectionBox.visible) {
        selectionBox.update();
      }
    });

    // Render loop
    const animate = () => {
      editorRef.current.animationId = requestAnimationFrame(animate);
      const delta = editorRef.current.clock.getDelta();
      editorRef.current.mixers.forEach(m => m.update(delta));
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

      // Save handleResize, etc.
      editorRef.current = { 
        ...editorRef.current, 
        scene, camera, renderer, 
        orbitControls: orbit, 
        transformControls: transform, 
        selectionBox,
        handleResize 
      };
  };

  const loadModelToEditor = (file, supportFiles = []) => {
    setMode('editor');
    setLoadingMsg(`Loading ${file.name}...`);
    
    // Defer initialization to allow React to apply display: block first
    setTimeout(() => {
      initEditor();

      const { scene, fileUrls, mixers } = editorRef.current;
      const ext = file.name.split('.').pop().toLowerCase();
      const id = genId();

      const manager = new THREE.LoadingManager();
      supportFiles.forEach(f => fileUrls[f.name.toLowerCase()] = URL.createObjectURL(f));
      const mainUrl = URL.createObjectURL(file);

      manager.setURLModifier((url) => {
        const filename = url.split('/').pop().toLowerCase();
        return fileUrls[filename] || url;
      });

      const finalizeLoad = (obj) => {
        // Auto center and scale
        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 5 / (maxDim || 1);
        
        obj.scale.set(scale, scale, scale);
        
        // Offset models so they don't stack in the center
        const existingCount = editorRef.current.models.length;
        const spacing = 6;
        const xOffset = (existingCount % 4) * spacing - (1.5 * spacing);
        const zOffset = -Math.floor(existingCount / 4) * spacing;

        obj.position.set(-center.x * scale + xOffset, -box.min.y * scale, -center.z * scale + zOffset);

        // Ensure all meshes cast shadows and have decent materials if none
        obj.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (!child.material || (Array.isArray(child.material) && child.material.length === 0)) {
            child.material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.1, roughness: 0.8 });
          } else {
             // force StandardMaterial for better lighting if possible, but keep existing if we want
          }
        }
      });

      scene.add(obj);
      
      const modelData = { id, name: file.name, object: obj, baseScale: scale };
      editorRef.current.models.push(modelData);
      
      setModels([...editorRef.current.models]);
      selectModel(id);
      setLoadingMsg("");
    };

    if (ext === 'obj') {
      const objLoader = new OBJLoader(manager);
      const mtlFile = supportFiles.find(f => f.name.toLowerCase().endsWith('.mtl'));
      
      if (mtlFile) {
        const mtlLoader = new MTLLoader(manager);
        mtlLoader.load(fileUrls[mtlFile.name.toLowerCase()], (materials) => {
          materials.preload();
          objLoader.setMaterials(materials);
          objLoader.load(mainUrl, finalizeLoad);
        });
      } else {
        objLoader.load(mainUrl, finalizeLoad);
      }
    } else if (ext === 'glb' || ext === 'gltf') {
      const gltfLoader = new GLTFLoader(manager);
      gltfLoader.load(mainUrl, (gltf) => {
        const obj = gltf.scene;
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(obj);
          gltf.animations.forEach(clip => mixer.clipAction(clip).play());
          mixers.push(mixer);
        }
        finalizeLoad(obj);
      });
    } else if (ext === '3ds') {
      const tdsLoader = new TDSLoader(manager);
      tdsLoader.load(mainUrl, (obj) => {
        // Many 3ds models are rotated 90 degrees on the X axis, but the user can use the sliders to fix it.
        finalizeLoad(obj);
      });
    } else if (ext === 'ply') {
      const viewer = new GaussianSplats3D.DropInViewer({
        sharedMemoryForWorkers: false,
        gpuAcceleratedSort: false,
      });
      const url = mainUrl + '#' + file.name;
      viewer.addSplatScene(url, { splatAlphaCrop: 0, showLoadingUI: true })
        .then(() => {
          finalizeLoad(viewer);
        })
        .catch(err => {
          console.error(err);
          setLoadingMsg("Error loading PLY splat in editor.");
        });
    }
    }, 100); // end setTimeout
  };

  const selectModel = (id) => {
    setSelectedId(prev => prev === id ? null : id);
  };

  // Robust sync for TransformControls and SelectionBox
  useEffect(() => {
    const { transformControls, selectionBox, models, scene } = editorRef.current;
    if (!transformControls || !scene) return;

    if (!selectedId) {
      transformControls.detach();
      if (selectionBox) selectionBox.visible = false;
      return;
    }

    const model = models.find(m => m.id === selectedId);
    if (model) {
      transformControls.attach(model.object);
      transformControls.setMode(transformMode || 'translate');
      transformControls.setSpace('world');
      
      // Force it to be in the scene and visible
      const helper = transformControls.getHelper();
      if (!scene.children.includes(helper)) {
        scene.add(helper);
      }
      helper.visible = true;
      
      if (selectionBox) {
        selectionBox.setFromObject(model.object);
        selectionBox.visible = true;
      }
    }
  }, [selectedId, transformMode, models]);

  const deleteSelected = () => {
    if (!selectedId) return;
    const { scene, transformControls, models } = editorRef.current;
    const idx = models.findIndex(m => m.id === selectedId);
    if (idx > -1) {
      scene.remove(models[idx].object);
      models.splice(idx, 1);
      transformControls.detach();
      setModels([...models]);
      setSelectedId(null);
    }
  };

  const updateMaterialProp = (prop, value) => {
    if (!selectedId) return;
    const model = editorRef.current.models.find(m => m.id === selectedId);
    if (!model) return;

    model.object.traverse(child => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
          if (prop === 'color') mat.color.set(value);
          else mat[prop] = parseFloat(value);
          mat.needsUpdate = true;
        });
      }
    });
    // Force re-render for UI sync
    setModels([...editorRef.current.models]);
  };

  const takeSnapshot = () => {
    const { renderer, scene, camera, selectionBox } = editorRef.current;
    if (!renderer) return;
    
    // Hide helpers before snapshot
    const helpers = [];
    scene.traverse(child => {
      if (child instanceof THREE.GridHelper || (editorRef.current.transformControls && child === editorRef.current.transformControls.getHelper())) {
        child.visible = false;
        helpers.push(child);
      }
    });
    if (selectionBox) {
      selectionBox.visible = false;
    }

    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    
    // Restore helpers
    helpers.forEach(h => h.visible = true);
    if (selectionBox && selectedId) {
      selectionBox.visible = true;
    }
    
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = '3d-snapshot.png';
    link.click();
  };

  // ==========================================
  // INITIALIZATION & UPLOAD
  // ==========================================
  useEffect(() => {
    // Load default
    fetch('/models/gaussians.ply')
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], 'gaussians.ply');
        loadSplat(file);
      }).catch(() => setLoadingMsg(""));
      
    return () => {
      // global cleanup
    };
  }, []);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    let mainFile = files.find(f => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.obj') || ext.endsWith('.glb') || ext.endsWith('.gltf') || ext.endsWith('.3ds') || ext.endsWith('.ply');
    });

    if (mainFile) {
      if (files.length > 1) {
        // User uploaded multiple files at once, load directly
        const sFiles = files.filter(f => f !== mainFile);
        loadModelToEditor(mainFile, sFiles);
      } else {
        // Single file uploaded, enter staging to ask for MTL/Textures
        setStagingObjFile(mainFile);
        setSupportFiles([]);
      }
    }
  };

  // Get active model props
  const activeModel = editorRef.current.models.find(m => m.id === selectedId);
  let activeColor = "#ffffff";
  let activeMetal = 0.5;
  let activeRough = 0.5;
  let activePosX = 0;
  let activePosZ = 0;
  let activeRotX = 0;
  let activeRotY = 0;
  let activeRotZ = 0;
  let activeScale = 1;

  if (activeModel) {
    // Transform values
    activePosX = activeModel.object.position.x;
    activePosZ = activeModel.object.position.z;
    activeRotX = THREE.MathUtils.radToDeg(activeModel.object.rotation.x);
    activeRotY = THREE.MathUtils.radToDeg(activeModel.object.rotation.y);
    activeRotZ = THREE.MathUtils.radToDeg(activeModel.object.rotation.z);
    // UI scale is a multiplier of the baseScale
    activeScale = activeModel.baseScale ? (activeModel.object.scale.x / activeModel.baseScale) : activeModel.object.scale.x;

    // Material values
    let found = false;
    activeModel.object.traverse(child => {
      if (!found && child.isMesh && child.material) {
        const mat = Array.isArray(child.material) ? child.material[0] : child.material;
        if (mat.color) activeColor = '#' + mat.color.getHexString();
        if (mat.metalness !== undefined) activeMetal = mat.metalness;
        if (mat.roughness !== undefined) activeRough = mat.roughness;
        found = true;
      }
    });
  }

  const updateTransform = (type, axis, value) => {
    if (!selectedId) return;
    const model = editorRef.current.models.find(m => m.id === selectedId);
    if (!model) return;
    
    const val = parseFloat(value);
    if (type === 'position') {
      model.object.position[axis] = val;
    } else if (type === 'rotation') {
      model.object.rotation[axis] = THREE.MathUtils.degToRad(val);
    } else if (type === 'scale') {
      // Multiply the slider value (0.1 to 10) by the object's baseScale
      const finalScale = model.baseScale ? val * model.baseScale : val;
      model.object.scale.set(finalScale, finalScale, finalScale);
    }
    
    if (editorRef.current.selectionBox) {
      editorRef.current.selectionBox.setFromObject(model.object);
    }
    setModels([...editorRef.current.models]); // force UI sync
  };

  return (
    <div className="app-container">
      <div className="vignette-overlay"></div>
      
      {/* Containers */}
      <div ref={splatContainerRef} className="viewer-container" style={{ display: mode === 'splat' ? 'block' : 'none' }} />
      <div ref={editorContainerRef} className="viewer-container" style={{ display: mode === 'editor' ? 'block' : 'none' }} />
      
      {loadingMsg && !stagingObjFile && (
        <div className="upload-overlay">
          <div className="game-panel">
            <h1 className="game-title">Loading...</h1>
            <p>{loadingMsg}</p>
            <div className="loader"></div>
          </div>
        </div>
      )}

      {/* Staging Overlay for OBJ */}
      {stagingObjFile && (
        <div className="upload-overlay">
          <div className="game-panel staging-panel">
            <h1 className="game-title">Almost Ready!</h1>
            <p>You selected <strong>{stagingObjFile.name}</strong></p>
            <p className="subtitle">If you have .mtl and texture images, upload them now (Optional).</p>
            
            <div className="staging-actions">
              <label className="action-btn secondary-btn">
                Select Textures / MTL
                <input 
                  type="file" 
                  multiple 
                  accept=".mtl,.png,.jpg,.jpeg,.bmp" 
                  onChange={(e) => setSupportFiles(Array.from(e.target.files))}
                />
              </label>
              
              {supportFiles.length > 0 && (
                <div className="support-files-list">
                  <p>{supportFiles.length} file(s) added:</p>
                  <small>{supportFiles.map(f => f.name).join(', ')}</small>
                </div>
              )}

              <div className="staging-buttons">
                <button className="action-btn cancel-btn" onClick={() => setStagingObjFile(null)}>Cancel</button>
                <button className="action-btn" onClick={() => {
                  loadModelToEditor(stagingObjFile, supportFiles);
                  setStagingObjFile(null);
                }}>Render 3D</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loadingMsg && !stagingObjFile && (
        <>
          {/* Header */}
          <header className="game-header">
            <div className="hud-badge">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>3D Workspace</span>
            </div>
            <div className="status-badge">
              <span className="dot pulse"></span>
              {mode === 'splat' ? 'Splat Mode' : 'Editor Mode'}
            </div>
          </header>

          {/* EDITOR UI */}
          {mode === 'editor' && (
            <>
              {/* Left Outliner */}
              <div className="outliner-panel">
                <h3 className="panel-heading">Scene Objects</h3>
                <ul className="model-list">
                  {models.map(m => (
                    <li 
                      key={m.id} 
                      className={`model-item ${selectedId === m.id ? 'selected' : ''}`}
                      onClick={() => selectModel(m.id)}
                    >
                      <span>{m.name}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right Properties */}
              {selectedId && (
                <div className="properties-panel" style={{ width: showProperties ? '280px' : 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showProperties ? '12px' : '0' }}>
                    {showProperties && <h3 className="panel-heading" style={{marginBottom: 0}}>Properties</h3>}
                    <button 
                      onClick={() => setShowProperties(!showProperties)} 
                      style={{
                        background: 'rgba(0,0,0,0.2)', 
                        border: '2px solid rgba(255,255,255,0.3)', 
                        borderRadius: '8px',
                        color: 'white', 
                        cursor: 'pointer', 
                        padding: '4px 8px',
                        fontWeight: 'bold',
                        marginLeft: showProperties ? '10px' : '0'
                      }}>
                      {showProperties ? 'Tutup ✖' : '⚙ Properties'}
                    </button>
                  </div>
                  
                  {showProperties && (
                    <>
                      <div className="toolbar">
                        <button className={`tool-btn ${transformMode === 'translate' ? 'active' : ''}`} onClick={() => setTransformMode('translate')}>Move</button>
                        <button className={`tool-btn ${transformMode === 'rotate' ? 'active' : ''}`} onClick={() => setTransformMode('rotate')}>Rotate</button>
                        <button className={`tool-btn ${transformMode === 'scale' ? 'active' : ''}`} onClick={() => setTransformMode('scale')}>Scale</button>
                      </div>

                  <div className="prop-group">
                    <label>Base Color</label>
                    <input type="color" value={activeColor} onChange={e => updateMaterialProp('color', e.target.value)} />
                  </div>
                  
                  <div className="prop-group">
                    <label>Position X (Kiri/Kanan)</label>
                    <input type="range" min="-50" max="50" step="0.5" value={activePosX} onChange={e => updateTransform('position', 'x', e.target.value)} />
                  </div>
                  
                  <div className="prop-group">
                    <label>Position Z (Depan/Belakang)</label>
                    <input type="range" min="-50" max="50" step="0.5" value={activePosZ} onChange={e => updateTransform('position', 'z', e.target.value)} />
                  </div>

                  <div className="prop-group">
                    <label>Rotation X (Maju/Mundur)</label>
                    <input type="range" min="-180" max="180" step="5" value={activeRotX} onChange={e => updateTransform('rotation', 'x', e.target.value)} />
                  </div>

                  <div className="prop-group">
                    <label>Rotation Y (Putar Kiri/Kanan)</label>
                    <input type="range" min="-180" max="180" step="5" value={activeRotY} onChange={e => updateTransform('rotation', 'y', e.target.value)} />
                  </div>
                  
                  <div className="prop-group">
                    <label>Rotation Z (Miring Kiri/Kanan)</label>
                    <input type="range" min="-180" max="180" step="5" value={activeRotZ} onChange={e => updateTransform('rotation', 'z', e.target.value)} />
                  </div>

                  <div className="prop-group">
                    <label>Scale (Ukuran)</label>
                    <input type="range" min="0.05" max="5" step="0.05" value={activeScale} onChange={e => updateTransform('scale', 'all', e.target.value)} />
                  </div>

                  <hr style={{margin: '12px 0', borderColor: 'rgba(255,255,255,0.2)'}} />

                  <div className="prop-group">
                    <label>Metalness</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeMetal} onChange={e => updateMaterialProp('metalness', e.target.value)} />
                  </div>

                  <div className="prop-group">
                    <label>Roughness</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeRough} onChange={e => updateMaterialProp('roughness', e.target.value)} />
                  </div>

                  <button className="action-btn cancel-btn" style={{width: '100%', marginTop: '10px'}} onClick={deleteSelected}>Delete Object</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Bottom Upload & Snapshot */}
          <div className="bottom-panel">
            {mode === 'editor' && (
              <button className="action-btn secondary-btn" onClick={takeSnapshot} style={{marginRight: '16px'}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                Snapshot
              </button>
            )}

            <label className="action-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Upload 3D Files
              <input 
                type="file" 
                multiple
                accept=".ply,.obj,.mtl,.glb,.gltf,.3ds,.png,.jpg,.jpeg" 
                onChange={handleFileUpload}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
