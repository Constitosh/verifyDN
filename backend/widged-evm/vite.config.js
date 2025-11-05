import { defineConfig } from 'vite';


export default defineConfig({
root: '.',
build: {
outDir: '.', // output files in same dir for express.static simplicity
emptyOutDir: false
},
server: { port: 5173, host: true }
});
