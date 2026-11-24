import { For, Show } from "solid-js";
import { Form, useForm } from "@void/solid";
import type { Props } from "./index.server";
import "./style.css";

export default function HomePage(props: Props) {
  const form = useForm("/", { text: "" });

  return (
    <main class="starter">
      <section id="center" aria-labelledby="welcome-title">
        <div class="hero">
          <img class="base" src="/stack.svg" width="170" height="179" alt="" />
          <img class="framework" src="/solid.svg" alt="Solid logo" />
          <img class="void" src="/void.svg" alt="Void logo" />
        </div>
        <div class="starter-intro">
          <h1 id="welcome-title">Welcome to Void</h1>
          <div class="starter-description">
            <p>
              This starter is running in Pages mode. The list below is loaded from your database in <code>pages/index.server.ts</code>.
            </p>
            <p>API example: <a href="/api/hello">/api/hello</a></p>
          </div>
        </div>
      </section>
      <div class="ticks" aria-hidden="true"></div>
      <section class="starter-demo" aria-labelledby="messages-title">
        <div class="demo-content">
          <h2 id="messages-title">Messages</h2>
          <Show when={props.messages.length > 0} fallback={
            <p class="empty-state">
              No messages yet. Run <code>void db seed</code> to load the sample row from <code>db/seed.ts</code>.
            </p>
          }>
            <ul class="messages">
              <For each={props.messages}>{(message) => (
                <li>
                  <strong>{message.text}</strong>
                  <small>{String(message.createdAt)}</small>
                </li>
              )}</For>
            </ul>
          </Show>
          <Form form={form} class="message-form">
            <label for="message-text">Message</label>
            <div class="message-fields">
              <input id="message-text" name="text" value={form.data.text} onInput={(event) => form.setData("text", event.currentTarget.value)} required maxLength={1000} />
              <button type="submit" disabled={form.pending}>Add message</button>
            </div>
          </Form>
        </div>
      </section>
      <div class="ticks" aria-hidden="true"></div>
      <section id="next-steps" aria-label="Resources">
        <div id="docs">
          <svg class="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://void.cloud/guide/quickstart" target="_blank" rel="noreferrer">
                Quickstart
              </a>
            </li>
            <li>
              <a href="https://www.solidjs.com/" target="_blank" rel="noreferrer">
                <img class="button-icon" src="/solid.svg" alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg class="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Void community</p>
          <ul>
            <li>
              <a href="https://github.com/voidzero-dev/void" target="_blank" rel="noreferrer">
                <svg class="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://discord.gg/cC6TEVFKSx" target="_blank" rel="noreferrer">
                <svg class="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/deploytovoid" target="_blank" rel="noreferrer">
                <svg class="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/voidzero.dev" target="_blank" rel="noreferrer">
                <svg class="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>
      <div class="ticks" aria-hidden="true"></div>
      <div id="spacer" aria-hidden="true"></div>
    </main>
  );
}
