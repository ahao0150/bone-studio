/**
 * AMF3 规范回归。
 *
 * 这三条规则都曾是真实 `.dbproj` 解码失败的根因（见 格式规范）：
 *   1. traits 引用是 `(index << 1) | 1`，内联定义的低两位才是 `0b11`；
 *   2. 空字符串**永不**进入字符串引用表；
 *   3. 数组的编码顺序是「关联部分在前、dense 值在后」。
 * 用手写字节流锁定行为，避免以后悄悄退回错误的引用语义。
 */
import { describe, expect, it } from 'vitest';
import { decodeAmf3 } from '../src/core/project/dbproj';

/** AMF3 字符串字面量：[header, ...utf8]（header = (len << 1) | 1） */
const str = (text: string): number[] => {
  const bytes = [...new TextEncoder().encode(text)];
  return [(bytes.length << 1) | 1, ...bytes];
};

/** 一个 dynamic、0 成员的类：对象 + 内联 traits + 空类名 */
const dynObject = (...body: number[]): number[] => [0x0a, 0x0b, 0x01, ...body];

describe('AMF3 规则回归', () => {
  it('traits 引用是 (index<<1)|1，不是 (index<<1)|0', () => {
    const bytes = new Uint8Array([
      // array(dense=2)，关联部分为空
      0x09, 0x05, 0x01,
      // obj1：内联 traits，成员 a = 1，空串 key 结束
      ...dynObject(...str('a'), 0x04, 0x01, 0x01),
      // obj2：traits 引用 index 0（= (0<<1)|1 = 0x01），成员 a = 2
      0x0a, 0x01, ...str('a'), 0x04, 0x02, 0x01,
    ]);
    const value = decodeAmf3(bytes) as Array<Record<string, unknown>>;
    expect(value[0]).toEqual({ a: 1 });
    // 若把 0x01 当成新类定义，会多读一个类名字符串并在此错位
    expect(value[1]).toEqual({ a: 2 });
  });

  it('空字符串不进入字符串引用表', () => {
    const bytes = new Uint8Array([
      0x09, 0x07, 0x01,          // array(dense=3)，关联部分为空
      0x06, 0x01,                // ""      —— 不能占用引用表
      0x06, ...str('abc'),       // "abc"   —— 这才是 strings[0]
      0x06, 0x00,                // 引用 strings[0]
    ]);
    // 若空串被 intern，第三个会变成 "" 而不是 "abc"
    expect(decodeAmf3(bytes)).toEqual(['', 'abc', 'abc']);
  });

  it('数组是「关联部分在前、dense 值在后」', () => {
    const bytes = new Uint8Array([
      0x09, 0x03,                // array(dense=1)
      ...str('k'), 0x04, 0x07,   // 关联：k = 7（key 是裸字符串，值要 marker）
      0x01,                      // 空串 key：关联部分结束
      0x06, ...str('v'),         // dense[0] = "v"（元素是 value，需要 string marker）
    ]);
    const value = decodeAmf3(bytes) as unknown[] & { k?: unknown };
    expect(value.k).toBe(7);
    expect(value[0]).toBe('v');
    expect(value.length).toBe(1);
  });

  it('整数与浮点按 AMF3 编码解码', () => {
    // integer 的 U29 是**原值**；只有 string/object/array/traits 用低位区分引用与字面量
    expect(decodeAmf3(new Uint8Array([0x04, 0x05]))).toBe(5);
    expect(decodeAmf3(new Uint8Array([0x04, 0x81, 0x00]))).toBe(128);
    expect(decodeAmf3(new Uint8Array([0x04, 0xff, 0xff, 0xff, 0xff]))).toBe(-1);
    const double = decodeAmf3(new Uint8Array([0x05, 0x40, 0x09, 0x21, 0xfb, 0x54, 0x44, 0x2d, 0x18]));
    expect(double).toBeCloseTo(Math.PI, 12);
  });
});
