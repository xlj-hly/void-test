import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidSolid } from "@void/solid/plugin";

export default defineConfig({
  plugins: [voidPlugin(), voidSolid()],
});
