// hud.js — everything drawn over the canvas: vitals, ammunition, money, the
// round clock, the score, the killfeed, banners, the buy menu, the channel
// bar for planting and defusing, and the scoreboard. It owns the DOM nodes
// index.html declares and nothing else; the game pushes numbers in.
import { WEAPONS, GRENADES } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const els = {
    health: $('health-num'),
    armor: $('armor-num'),
    money: $('money-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenades: $('grenade-count'),
    timer: $('timer'),
    phase: $('phase-label'),
    scoreW: $('score-w'),
    scoreB: $('score-b'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    hitmarker: $('hitmarker'),
    crosshair: $('crosshair'),
    damage: $('damage'),
    flash: $('flash'),
    channelWrap: $('channel-wrap'),
    channelFill: $('channel-fill'),
    channelLabel: $('channel-label'),
    bombStatus: $('bomb-status'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    scoreboard: $('scoreboard'),
    scoreRows: $('score-rows'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    playBtn: $('play-btn'),
    scope: $('scope'),
  };

  let bannerTimer = 0;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  return {
    els,
    setHealth(v) {
      els.health.textContent = Math.max(0, Math.ceil(v));
      els.health.classList.toggle('low', v <= 30);
    },
    setArmor(v) {
      els.armor.textContent = Math.max(0, Math.ceil(v));
    },
    setMoney(v) {
      els.money.textContent = `$${v}`;
    },
    setAmmo(mag, reserve, reloading) {
      els.ammoMag.textContent = reloading ? '--' : mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammoMag.classList.toggle('low', !reloading && mag <= 5);
    },
    setWeapon(label) {
      els.weaponName.textContent = label;
    },
    setGrenades(frag, flash) {
      els.grenades.textContent = `FRAG ${frag} · FLASH ${flash}`;
    },
    setTimer(text, urgent) {
      els.timer.textContent = text;
      els.timer.classList.toggle('urgent', !!urgent);
    },
    setPhase(text) {
      els.phase.textContent = text;
    },
    setScores(w, b) {
      els.scoreW.textContent = w;
      els.scoreB.textContent = b;
    },
    setBombStatus(text) {
      els.bombStatus.textContent = text;
      els.bombStatus.style.display = text ? 'block' : 'none';
    },
    banner(title, sub = '', holdMs = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.add('show');
      window.clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => els.banner.classList.remove('show'), holdMs);
    },
    killfeed(killerName, killerTeam, victimName, victimTeam, weaponLabel, headshot) {
      const row = document.createElement('div');
      row.className = 'kf-row';
      row.innerHTML =
        `<span class="${killerTeam}">${esc(killerName)}</span>` +
        `<em>${esc(weaponLabel)}${headshot ? ' ⌖' : ''}</em>` +
        `<span class="${victimTeam}">${esc(victimName)}</span>`;
      els.killfeed.appendChild(row);
      while (els.killfeed.children.length > 5) els.killfeed.firstChild.remove();
      window.setTimeout(() => row.classList.add('fade'), 4200);
      window.setTimeout(() => row.remove(), 5000);
    },
    hitmarker(kill) {
      els.hitmarker.classList.toggle('kill', !!kill);
      els.hitmarker.classList.add('on');
      window.setTimeout(() => els.hitmarker.classList.remove('on'), kill ? 220 : 110);
    },
    damageFlash() {
      els.damage.classList.add('on');
      window.setTimeout(() => els.damage.classList.remove('on'), 130);
    },
    setFlash(v) {
      els.flash.style.opacity = String(Math.max(0, Math.min(1, v)));
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--sp', `${Math.round(px)}px`);
    },
    setScope(on) {
      els.scope.style.display = on ? 'block' : 'none';
      els.crosshair.style.opacity = on ? '0' : '1';
    },
    channel(label, frac) {
      if (frac === null) {
        els.channelWrap.style.display = 'none';
        return;
      }
      els.channelWrap.style.display = 'block';
      els.channelLabel.textContent = label;
      els.channelFill.style.width = `${Math.round(frac * 100)}%`;
    },
    // items: [{key, label, price, note, canBuy, owned}]
    renderBuy(money, items, open) {
      els.buyMenu.style.display = open ? 'block' : 'none';
      if (!open) return;
      els.buyMoney.textContent = `$${money}`;
      els.buyItems.innerHTML = items
        .map(
          (it, i) =>
            `<div class="buy-item ${it.canBuy ? '' : 'cant'} ${it.owned ? 'owned' : ''}">` +
            `<span class="buy-key">${i + 1}</span>` +
            `<span class="buy-label">${esc(it.label)}</span>` +
            `<span class="buy-note">${esc(it.note ?? '')}</span>` +
            `<span class="buy-price">${it.owned ? 'OWNED' : `$${it.price}`}</span></div>`,
        )
        .join('');
    },
    scoreboard(rows) {
      if (!rows) {
        els.scoreboard.style.display = 'none';
        return;
      }
      els.scoreboard.style.display = 'block';
      els.scoreRows.innerHTML = rows
        .map(
          (r) =>
            `<div class="sb-row ${r.team}"><span>${esc(r.name)}</span><span>${r.kills}</span><span>${r.deaths}</span><span>$${r.money}</span></div>`,
        )
        .join('');
    },
    showOverlay(title, copy, button) {
      els.overlayTitle.textContent = title;
      els.overlayCopy.innerHTML = copy;
      els.playBtn.textContent = button;
      els.overlay.style.display = 'grid';
    },
    hideOverlay() {
      els.overlay.style.display = 'none';
    },
    onPlay(fn) {
      els.playBtn.addEventListener('click', fn);
    },
  };
}

export function weaponLabel(kind) {
  return WEAPONS[kind]?.label ?? kind;
}
export function grenadeLabel(kind) {
  return GRENADES[kind]?.label ?? kind;
}
