/**
 * 账号名校验规则。
 *
 * 单独放在这里是为了让浏览器端脚本也能导入：accounts.ts 依赖 node:crypto /
 * fs，不能进客户端 bundle。规则只有一处，服务端注册和登录页校验必须一致。
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export const isValidUsername = (username: string): boolean => USERNAME_PATTERN.test(username);