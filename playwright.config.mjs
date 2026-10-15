import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'scripts',testMatch:'png-designer.spec.mjs',workers:1,use:{baseURL:'http://127.0.0.1:4175',headless:true},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4175',url:'http://127.0.0.1:4175',reuseExistingServer:!process.env.CI}});
