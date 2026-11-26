import { For, Show } from 'solid-js';
import type { Props } from './index.server';
import './style.css';

export default function HomePage(props: Props) {
  return (
    <main class="hall">
      <header class="masthead"><strong class="brand">四方牌桌</strong></header>
      <section class="catalog">
        <h1>游戏大厅</h1>
        <ul class="catalog-grid">
          <For each={props.games}>{(game) => <li>
            <a class="catalog-card game-card" href={`/games/${game.id}`}>
              <Show when={game.id === 'mahjong'}>
                <div class="lobby-tiles" aria-hidden="true"><span>東</span><span>中</span><span>發</span></div>
              </Show>
              <strong>{game.name}</strong>
            </a>
          </li>}</For>
        </ul>
      </section>
    </main>
  );
}
