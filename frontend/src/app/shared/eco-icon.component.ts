import { Component, input } from '@angular/core';
import { Ecosystem } from './ecosystems';

@Component({
  selector: 'eco-icon',
  standalone: true,
  template: `
    @switch (ecosystem()) {
      @case ('NPM') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/npm/npm-original.svg"
          alt="npm"
          width="32"
          height="32"
          class="eco-img"
          loading="eager"
        />
      }
      @case ('MAVEN') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/maven/maven-original.svg"
          alt="Maven"
          width="32"
          height="32"
          class="eco-img"
          loading="eager"
        />
      }
      @case ('PYPI') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/pypi/pypi-original.svg"
          alt="PyPI"
          width="32"
          height="32"
          class="eco-img"
          loading="eager"
        />
      }
      @case ('GO') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original-wordmark.svg"
          alt="Go"
          width="32"
          height="32"
          class="eco-img"
          loading="eager"
        />
      }
      @case ('CARGO') {
        <img
          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rust/rust-original.svg"
          alt="Cargo"
          width="32"
          height="32"
          class="eco-img mono-icon"
          loading="eager"
        />
      }
      @case ('TEST') {
        <span class="test-icon" role="img" aria-label="TEST">🧪</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
      align-items: center;
    }
    .eco-img {
      display: block;
      width: 32px;
      height: 32px;
      object-fit: contain;
    }
    /* black logo: light in dark mode */
    :host-context(html.dark) .mono-icon {
      filter: invert(1);
    }
    .test-icon {
      font-size: 24px;
      line-height: 32px;
      width: 32px;
      text-align: center;
    }
  `,
})
export class EcoIconComponent {
  ecosystem = input.required<Ecosystem>();
}
