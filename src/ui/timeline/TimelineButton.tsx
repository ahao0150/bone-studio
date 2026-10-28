import type { MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../icons';

/**
 * 时间轴里的方形图标钮（官方 `IconButton` / `_829` 两态钮，约 22×22）。
 * `stub` = 官方有、本工程还没有对应功能：照位置画出来但置灰（`data-tl-stub`）。
 */
export function TlButton(props: {
  icon: string;
  title: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  on?: boolean;
  stub?: boolean;
  data?: Record<string, string>;
}) {
  const { icon, title, onClick, disabled, on, stub, data } = props;
  return (
    <button
      type="button"
      className={`dbtl-btn${on ? ' on' : ''}`}
      title={stub ? `${title}（未实现）` : title}
      disabled={disabled || stub}
      onClick={onClick}
      {...(stub ? { 'data-tl-stub': '' } : {})}
      {...data}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
