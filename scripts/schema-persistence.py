#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真实 SQLite 回归：模拟 CI 连续两次执行 schema.sql，验证用户案例展示开关
与标题/描述不会被抹掉。

背景：旧版 schema.sql 里有一段「CREATE subdomains_mr → INSERT → RENAME」
原子切换，每次部署都会重建 subdomains 表，而 INSERT 列清单里没有
showcase / showcase_title / showcase_desc / showcase_emoji，于是用户开启的
展示每次更新都消失。这个脚本把该 bug 固化成阻断断言。

CI（ubuntu-latest 自带 python3）每次部署都会跑，不依赖任何第三方库。
"""
import sqlite3
import os
import sys

SQL = os.path.join(os.path.dirname(__file__), '..', 'schema.sql')


def deploy(con, label):
    with open(SQL, encoding='utf-8') as f:
        con.executescript(f.read())
    print(f'  {label}: schema.sql 执行成功')


def main():
    con = sqlite3.connect(':memory:')
    deploy(con, '第 1 次部署')

    con.execute(
        "INSERT INTO users (email,password_hash,role,status,quota,created_at) "
        "VALUES ('owner@example.com','x','user','active',5,1)"
    )
    con.execute(
        "INSERT INTO subdomains "
        "(label,root_domain,fqdn,user_id,status,created_at,updated_at,"
        " showcase,showcase_title,showcase_desc,showcase_emoji) "
        "VALUES ('demo','meoy.top','demo.meoy.top',1,'approved',1,1,"
        " 1,'我的主页','一句话介绍','')"
    )
    con.commit()

    before = con.execute(
        "SELECT showcase,showcase_title,showcase_desc FROM subdomains "
        "WHERE fqdn='demo.meoy.top'"
    ).fetchone()
    print('  部署前:', before)
    if before != (1, '我的主页', '一句话介绍'):
        print('✗ 初始数据写入失败')
        return 1

    deploy(con, '第 2 次部署')
    after = con.execute(
        "SELECT showcase,showcase_title,showcase_desc FROM subdomains "
        "WHERE fqdn='demo.meoy.top'"
    ).fetchone()
    count = con.execute('SELECT COUNT(*) FROM subdomains').fetchone()[0]
    print('  部署后:', after, '| 域名行数:', count)

    if after != before:
        print('✗ 重复执行 schema.sql 后用户案例数据被抹掉')
        return 1
    if count != 1:
        print('✗ 重建表导致域名行丢失或重复')
        return 1
    if after[0] != 1:
        print('✗ 展示开关被重置为 0')
        return 1

    cols = [r[1] for r in con.execute('PRAGMA table_info(subdomains)').fetchall()]
    for c in ('root_domain', 'showcase', 'showcase_title', 'showcase_desc', 'showcase_emoji'):
        if c not in cols:
            print(f'✗ 主表缺列 {c}')
            return 1
    print('✓ 结论：连续部署两次后展示开关 / 标题 / 描述 / 域名数据完整保留')
    return 0


if __name__ == '__main__':
    sys.exit(main())
