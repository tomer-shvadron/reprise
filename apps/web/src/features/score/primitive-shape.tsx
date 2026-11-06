import type { Primitive } from '@reprise/layout';
import type { ReactElement } from 'react';

import { primitiveToSvg } from './primitive-svg';

/** A plain function rather than a component, so a system's ~1 400 primitives add no fibers. */
export function renderPrimitive(primitive: Primitive, key: number): ReactElement {
  const shape = primitiveToSvg(primitive);
  switch (shape.tag) {
    case 'text': {
      return (
        <text key={key} {...shape.props}>
          {shape.text}
        </text>
      );
    }
    case 'line': {
      return <line key={key} {...shape.props} />;
    }
    case 'path': {
      return <path key={key} {...shape.props} />;
    }
  }
}
