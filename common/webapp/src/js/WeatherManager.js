import * as THREE from "three";
import {RevalidatingFileLoader} from "./util/RevalidatingFileLoader";
import {alert, dispatchEvent} from "./util/Utils";

export class WeatherManager {

    /**
     * @param scene {THREE.Scene}
     * @param fileUrl {string}
     * @param events {EventTarget}
     */
    constructor(scene, fileUrl, events) {
        this.scene = scene;
        this.fileUrl = fileUrl;
        this.events = events;

        this.updateInterval = 2000;
        this.timeout = null;
        this.disposed = false;

        this.isRaining = false;
        this.isThundering = false;

        // Rain particles as 3D boxes
        this.particleCount = 1500; // Mucho menos denso, como Minecraft
        this.rainGeometry = new THREE.BoxGeometry(0.06, 1.2, 0.06); // Algo más gorditas y no tan largas
        this.rainMaterial = new THREE.MeshBasicMaterial({
            color: 0x3366cc, // Azul mucho más oscuro y puro para que no se vea blanco con la luz
            transparent: true,
            opacity: 0.8, // Más opaco para que destaque contra el cielo
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        this.rainSystem = new THREE.InstancedMesh(this.rainGeometry, this.rainMaterial, this.particleCount);
        this.rainSystem.visible = false;
        
        this.velocities = new Float32Array(this.particleCount);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < this.particleCount; i++) {
            dummy.position.x = Math.random() * 80 - 40;
            dummy.position.y = Math.random() * 80 - 40;
            dummy.position.z = Math.random() * 80 - 40;
            dummy.updateMatrix();
            this.rainSystem.setMatrixAt(i, dummy.matrix);
            this.velocities[i] = -(Math.random() * 15 + 35);
        }
        
        this.scene.add(this.rainSystem);

        this.fileLoader = new RevalidatingFileLoader();
        this.fileLoader.setResponseType("json");

        this.onRenderFrame = this.animate.bind(this);
        this.events.addEventListener("bluemapRenderFrame", this.onRenderFrame);
        this.events.addEventListener("bluemapMapInteraction", this.onMapInteraction);

        // Start the loop
        this.update();
        
        this.lastTime = performance.now();
    }

    onMapInteraction = () => {
        // can be used if needed
    }

    animate(event) {
        if (this.disposed) return;
        
        let delta = event.detail.delta / 1000; // Tomamos el delta exacto del motor de BlueMap
        if (!delta || delta <= 0) delta = 0.016;

        // Si la pestaña estaba en segundo plano, evitamos saltos temporales enormes
        if (delta > 0.1) delta = 0.1;

        if (this.isRaining && this.rainSystem.visible) {
            let matrices = this.rainSystem.instanceMatrix.array;
            
            for (let i = 0; i < this.particleCount; i++) {
                matrices[i * 16 + 13] += this.velocities[i] * delta; // 13 is the Y position in 4x4 matrix
                
                // Si la gota cae por debajo del límite, reaparece arriba conservando su offset
                if (matrices[i * 16 + 13] < -40) {
                    matrices[i * 16 + 13] += 80; // Hace loop sin crear "huecos"
                    this.velocities[i] = -(Math.random() * 15 + 35);
                }
            }
            this.rainSystem.instanceMatrix.needsUpdate = true;
            
            // Forzamos al motor a redibujar contínuamente a 60 FPS llamando a un evento ligero
            dispatchEvent(this.events, "bluemapTileLoaded", {});
        }
    }

    updatePosition(cameraPosition) {
        if (!this.rainSystem) return;
        // Make the rain volume center around the camera
        this.rainSystem.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
    }

    update() {
        if (this.disposed) return;

        this.fileLoader.load(this.fileUrl,
            this.onDataLoaded,
            () => {},
            () => {}
        );

        this.timeout = setTimeout(() => this.update(), this.updateInterval);
    }

    onDataLoaded = (data) => {
        if (this.disposed) return;

        if (data) {
            this.isRaining = !!data.isRaining;
            this.isThundering = !!data.isThundering;

            if (this.isRaining) {
                this.rainSystem.visible = true;
                if (this.isThundering) {
                    this.rainMaterial.color.setHex(0x446699); // darker rain for thunder
                } else {
                    this.rainMaterial.color.setHex(0x6699ff); // normal bright rain
                }
            } else {
                this.rainSystem.visible = false;
            }
        }
    }

    dispose() {
        this.disposed = true;
        if (this.timeout) clearTimeout(this.timeout);
        this.events.removeEventListener("bluemapRenderFrame", this.onRenderFrame);
        this.events.removeEventListener("bluemapMapInteraction", this.onMapInteraction);

        if (this.scene && this.rainSystem) {
            this.scene.remove(this.rainSystem);
        }

        if (this.rainGeometry) this.rainGeometry.dispose();
        if (this.rainMaterial) this.rainMaterial.dispose();
    }
}
