# -*- coding: utf-8 -*-
"""生成 src/lib/appSchema.ts —— App 全站功能的声明式描述（服务端唯一真源）。

运行：python3 scripts/gen-app-schema.py
改功能只改本文件的 GROUPS / SETTINGS，然后重跑；app-api-regression 会校验覆盖。
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ── 后台设置字段：postKey | rawKey 兜底 | 类型 | 中文 | 英文 | 分组号 ──
SETTINGS_RAW = """
siteName|site_name|text|站点名称|Site name|0
logoUrl|logo_url|text|Logo 地址|Logo URL|0
faviconUrl|favicon_url|text|Favicon 地址|Favicon URL|0
announcement|announcement|area|站点公告|Announcement|0
reservedLabels|reserved_labels|area|额外保留名称|Reserved labels|0
captchaEnabled|captcha_enabled|bool|注册滑块验证|Slider captcha|1
captchaImages|captcha_images|text|滑块图库|Slider images|1
mailVerifyRequired|mail_verify_required|bool|注册需邮箱验证码|Require email code|1
emailRule|email_rule|text|注册邮箱规则|Signup email rule|1
maxAccountsPerIp|max_accounts_per_ip|num|每 IP 账号上限|Max accounts per IP|1
initialPoints|initial_points|num|初始积分|Initial points|2
checkinPoints|checkin_points|num|签到积分|Check-in points|2
domainCost|domain_cost|num|域名积分消耗|Domain cost|2
shortDomainCost|short_domain_cost|num|短域名消耗|Short domain cost|2
shortDomainLen|short_domain_len|num|短域名长度阈值|Short label length|2
comboRewardPoints|combo_reward_points|num|连续签到奖励|Combo reward|2
showcaseRewardPoints|showcase_reward_points|num|案例展示奖励|Showcase reward|2
rootPointCosts|root_point_costs|area|后缀积分成本|Per-root costs|2
defaultQuota|default_quota|num|默认配额|Default quota|3
domainValidDays|domain_valid_days|num|域名有效天数|Valid days|3
renewWindowDays|renew_window_days|num|续期窗口（天）|Renew window|3
rootRegLimits|root_reg_limits|area|后缀注册上限|Per-root limits|3
applyPaused|apply_paused|bool|暂停新申请|Pause applications|3
applyPausedMessage|apply_paused_message|area|暂停提示|Pause notice|3
rootApplyPaused|root_apply_paused|area|按后缀暂停|Per-root pause|3
mailProvider|mail_provider|select|邮件服务商|Mail provider|4
mailFrom|mail_from|text|发件人|Mail from|4
mailApiKey|mail_api_key|secret|邮件 API Key|Mail API key|4
abuseEmail|abuse_email|text|滥用投诉邮箱|Abuse email|4
abuseReportUrl|abuse_report_url|text|外部举报入口|Abuse report URL|4
dnsApiUrl|dns_api_url|text|DNS API 地址|DNS API URL|5
dnsApiKey|dns_api_key|secret|DNS API Key|DNS API key|5
dnsApiSecret|dns_api_secret|secret|DNS API Secret|DNS API secret|5
dnsheApiKey|dnshe_api_key|secret|DNSHE Key|DNSHE key|5
dnsheApiSecret|dnshe_api_secret|secret|DNSHE Secret|DNSHE secret|5
spaceshipApiUrl|spaceship_api_url|text|Spaceship API|Spaceship API|5
spaceshipApiKey|spaceship_api_key|secret|Spaceship Key|Spaceship key|5
spaceshipApiSecret|spaceship_api_secret|secret|Spaceship Secret|Spaceship secret|5
dnsPausedRoots|dns_paused_roots|area|暂停解析后缀|DNS-paused roots|5
dnsMigrationNotice|dns_migration_notice|area|迁移公告|Migration notice|5
r2PublicUrl|r2_public_url|text|R2 公共资源地址|R2 public URL|5
hostingPanelDomain|hosting_panel_domain|text|主机面板域名|Hosting panel domain|5
hostingPanelName|hosting_panel_name|text|主机面板名称|Hosting panel name|5
aiEnabled|ai_review_enabled|bool|AI 自动审核|AI review|6
aiRoots|ai_review_roots|area|AI 审核后缀|AI review roots|6
aiDnsUnlimitedRoots|dns_unlimited_roots|area|不限记录数后缀|Unlimited-record roots|6
aiProvider|ai_provider|select|AI 服务商|AI provider|6
aiUrl|ai_api_url|text|AI API 地址|AI API URL|6
aiEndpointMode|ai_endpoint_mode|select|AI 接口模式|AI endpoint mode|6
aiModel|ai_model|text|AI 模型|AI model|6
aiApiKey|ai_api_key|secret|AI API Key|AI API key|6
nodelocEnabled|nodeloc_enabled|bool|NodeLoc 登录|NodeLoc login|7
nodelocClientId|nodeloc_client_id|text|NodeLoc Client ID|NodeLoc client ID|7
nodelocClientSecret|nodeloc_client_secret|secret|NodeLoc Secret|NodeLoc secret|7
nodelocAutoRegister|nodeloc_auto_register|bool|NodeLoc 自动注册|NodeLoc auto-register|7
nodelocRedirectUri|nodeloc_redirect_uri|text|NodeLoc 回调|NodeLoc redirect URI|7
githubEnabled|github_enabled|bool|GitHub 登录|GitHub login|7
githubClientId|github_client_id|text|GitHub Client ID|GitHub client ID|7
githubClientSecret|github_client_secret|secret|GitHub Secret|GitHub secret|7
githubAutoRegister|github_auto_register|bool|GitHub 自动注册|GitHub auto-register|7
githubRedirectUri|github_redirect_uri|text|GitHub 回调|GitHub redirect URI|7
githubStarRepo|github_star_repo|text|Star 仓库|Star repo|7
githubStarBonus|github_star_bonus|num|Star 奖励积分|Star bonus|7
anynsRoots|anyns_roots|area|AnyNS 后缀|AnyNS roots|8
anynsZoneId|anyns_zone_id|text|AnyNS Zone ID|AnyNS zone ID|8
anynsZoneIds|anyns_zone_ids|area|AnyNS Zone 映射|AnyNS zone map|8
anynsApiToken|anyns_api_token|secret|AnyNS Token|AnyNS token|8
seusZoneIds|seus_zone_ids|area|SEUS Zone 映射|SEUS zone map|8
seusApiToken|seus_api_token|secret|SEUS Token|SEUS token|8
footerIcpHtml|footer_icp_html|area|页脚备案号|Footer ICP|9
footerContactHtml|footer_contact_html|area|页脚联系方式|Footer contact|9
whoisHolder|whois_holder|text|WHOIS 持有人|WHOIS holder|9
fontBody|font_body|text|正文字体|Body font|10
fontDisplay|font_display|text|标题字体|Display font|10
"""
GROUP_ZH = ['站点与外观', '注册与验证', '积分与配额', '域名与有效期',
            '邮件与通知', 'DNS 与服务商', 'AI 审核', '第三方登录',
            '第三方域名', '页脚与合规', '字体与展示']
GROUP_EN = ['Appearance', 'Signup & verification', 'Points & quota', 'Domains & expiry',
            'Mail & notices', 'DNS providers', 'AI review', 'OAuth',
            'External domains', 'Footer & legal', 'Fonts & display']

OPTIONS = {
    'mailProvider': [['resend', 'Resend'], ['smtp', 'SMTP'], ['mailgun', 'Mailgun'], ['', '未配置']],
    'aiProvider': [['openai', 'OpenAI 兼容'], ['workers-ai', 'Workers AI'], ['', '未配置']],
    'aiEndpointMode': [['chat', '/chat/completions'], ['responses', '/responses'], ['auto', '自动']],
}


def parse_settings():
    out = []
    for line in SETTINGS_RAW.strip().splitlines():
        p = line.split('|')
        if len(p) != 6:
            continue
        d = dict(zip(['k', 'raw', 't', 'l', 'le', 'g'], p[:6]))
        if d['k'] in OPTIONS:
            d['opt'] = OPTIONS[d['k']]
        out.append(d)
    return out


def act(i, zh, en, ep, m, **kw):
    d = {'id': i, 'l': zh, 'le': en, 'ep': ep, 'm': m}
    d.update(kw)
    return d


def form(i, zh, en, ep, m, fs, **kw):
    d = {'id': i, 'l': zh, 'le': en, 'ep': ep, 'm': m, 'fields': fs}
    d.update(kw)
    return d


def fld(k, zh, en, t='text', **kw):
    d = {'k': k, 'l': zh, 'le': en, 't': t}
    d.update(kw)
    return d


def build_settings_screens(fields):
    screens = []
    for gi, zh in enumerate(GROUP_ZH):
        fs = [f for f in fields if int(f['g']) == gi]
        if not fs:
            continue
        screens.append({
            'id': 'set_' + str(gi), 'l': zh, 'le': GROUP_EN[gi], 'icon': 'tune', 'admin': True,
            'forms': [form('f', '保存设置', 'Save changes', 'adminSettings', 'POST', fs)],
            'actions': [act('reload', '重新读取', 'Reload', 'adminSettings', 'GET', load=True)],
        })
    return screens


def groups(settings_screens):
    return [
        {'id': 'g_overview', 'l': '概览与首页', 'le': 'Overview', 'icon': 'home', 'screens': [
            {'id': 'home', 'l': '站点数据', 'le': 'Site stats', 'icon': 'home',
             'load': {'ep': 'stats', 'items': 'publicStats'},
             'actions': [act('refresh', '刷新', 'Refresh', 'stats', 'GET', load=True)]},
            {'id': 'config', 'l': '公开配置', 'le': 'Public config', 'icon': 'info',
             'load': {'ep': 'config', 'items': 'site'}, 'actions': []},
            {'id': 'terms', 'l': '服务条款', 'le': 'Terms', 'icon': 'doc',
             'load': {'ep': 'terms', 'items': 'terms'}, 'actions': []},
            {'id': 'rules', 'l': '使用规则', 'le': 'Rules', 'icon': 'doc',
             'load': {'ep': 'rules', 'items': 'rules'}, 'actions': []},
            {'id': 'showcase', 'l': '用户案例墙', 'le': 'Showcase', 'icon': 'star',
             'load': {'ep': 'showcase', 'items': 'items'}, 'actions': []},
        ]},
        {'id': 'g_domain', 'l': '域名', 'le': 'Domains', 'icon': 'domain', 'screens': [
            {'id': 'check', 'l': '查询可用性', 'le': 'Check availability', 'icon': 'search',
             'forms': [form('chk', '查询', 'Check', 'check', 'GET', [
                 fld('label', '名称', 'Label'), fld('root', '后缀', 'Root'),
                 fld('discountCode', '优惠码', 'Discount code')])], 'actions': []},
            {'id': 'whois', 'l': 'WHOIS 查询', 'le': 'WHOIS lookup', 'icon': 'search',
             'forms': [form('w', '查询', 'Lookup', 'whois', 'GET', [fld('name', '域名', 'Domain')])],
             'actions': []},
            {'id': 'mine', 'l': '我的域名', 'le': 'My domains', 'icon': 'list',
             'load': {'ep': 'mine', 'items': 'items'},
             'rowActions': [
                 act('detail', 'DNS 记录', 'DNS records', 'records', 'GET', native='domain', vars=['id']),
                 act('edit', '修改备注', 'Edit note', 'subdomainUpdate', 'PATCH', vars=['id'],
                     fields=[fld('note', '备注', 'Note')]),
                 act('renew', '续期', 'Renew', 'renew', 'POST', vars=['id'], confirm=True),
                 act('del', '释放', 'Release', 'subdomainDelete', 'DELETE', vars=['id'], confirm=True, danger=True)],
             'actions': [act('apply', '申请子域名', 'Apply', 'apply', 'POST', native='apply')]},
            {'id': 'soa', 'l': 'SOA 信息', 'le': 'SOA record', 'icon': 'info',
             'load': {'ep': 'soa', 'items': 'soa'}, 'actions': []},
            {'id': 'providers', 'l': '注册商列表', 'le': 'Registrars', 'icon': 'list',
             'load': {'ep': 'subdomainProviders', 'items': 'items'}, 'actions': []},
        ]},
        {'id': 'g_dns', 'l': 'DNS 记录', 'le': 'DNS records', 'icon': 'dns', 'screens': [
            {'id': 'dns', 'l': '记录增删改', 'le': 'Records', 'icon': 'dns', 'native': 'domain',
             'load': {'ep': 'records', 'items': 'records'}, 'actions': []},
            {'id': 'deleg', 'l': 'NS 委派', 'le': 'NS delegation', 'icon': 'dns',
             'load': {'ep': 'delegationProviders', 'items': 'items'},
             'rowActions': [act('use', '使用此服务商', 'Use provider', 'delegation', 'POST',
                                vars=['id'], fields=[fld('id', '域名 ID', 'Domain ID', 'num'),
                                                    fld('provider', '标识', 'Key')])],
             'actions': [act('check', '检查委派', 'Check delegation', 'delegationCheck', 'POST',
                             vars=['id'], fields=[fld('id', '域名 ID', 'Domain ID', 'num')]),
                         act('alt', '设置委派（兼容前缀）', 'Set delegation (alt)', 'delegationAlt', 'POST',
                             vars=['id'], fields=[fld('id', '域名 ID', 'Domain ID', 'num'),
                                                 fld('provider', '服务商', 'Provider')]),
                         act('altcheck', '检查委派（兼容前缀）', 'Check (alt)', 'delegationAltCheck', 'POST',
                             vars=['id'], fields=[fld('id', '域名 ID', 'Domain ID', 'num')])]},
        ]},
        {'id': 'g_points', 'l': '积分与奖励', 'le': 'Points & rewards', 'icon': 'star', 'screens': [
            {'id': 'points', 'l': '我的积分', 'le': 'My points', 'icon': 'star',
             'load': {'ep': 'pointsMe', 'items': 'points'},
             'actions': [act('checkin', '每日签到', 'Daily check-in', 'checkin', 'POST'),
                         act('cost', '积分成本', 'Points cost', 'pointsCost', 'GET', load=True)]},
            {'id': 'rewards', 'l': '奖励与兑换', 'le': 'Rewards', 'icon': 'gift',
             'load': {'ep': 'rewards', 'items': 'items'},
             'forms': [form('redeem', '兑换码', 'Redeem', 'redeem', 'POST', [fld('code', '兑换码', 'Code')])],
             'actions': [act('preview', '预览兑换码', 'Preview code', 'redeemPreview', 'GET',
                             fields=[fld('code', '兑换码', 'Code')]),
                         act('mine', '兑换记录', 'Redeem history', 'redeemMine', 'GET', load=True)]},
            {'id': 'redeem_admin', 'l': '兑换码管理', 'le': 'Redeem codes', 'icon': 'gift', 'admin': True,
             'load': {'ep': 'redeemList', 'items': 'items'},
             'forms': [form('gen', '生成兑换码', 'Generate', 'redeemGenerate', 'POST', [
                 fld('count', '数量', 'Count', 'num'), fld('points', '积分', 'Points', 'num')])],
             'rowActions': [act('toggle', '启用 / 停用', 'Toggle', 'redeemToggle', 'POST', vars=['id']),
                            act('del', '删除', 'Delete', 'redeemDelete', 'DELETE', vars=['id'],
                                confirm=True, danger=True)],
             'actions': [act('clear', '清空全部兑换码', 'Delete all codes', 'redeemAdminAllDelete', 'DELETE',
                             confirm=True, danger=True)]},
        ]},
        {'id': 'g_account', 'l': '账号与安全', 'le': 'Account', 'icon': 'person', 'screens': [
            {'id': 'me', 'l': '登录态', 'le': 'Session', 'icon': 'person',
             'load': {'ep': 'me', 'items': 'user'},
             'actions': [act('logout', '退出登录', 'Sign out', 'logout', 'POST', confirm=True)]},
            {'id': 'profile', 'l': '个人资料', 'le': 'Profile', 'icon': 'person',
             'load': {'ep': 'profile', 'items': 'profile'},
             'forms': [form('save', '保存资料', 'Save profile', 'profile', 'PUT', [
                 fld('nickname', '昵称', 'Nickname'), fld('bio', '简介', 'Bio', 'area'),
                 fld('avatar', '头像', 'Avatar')])],
             'actions': [act('avatar', '上传头像', 'Upload avatar', 'profileAvatar', 'POST',
                             fields=[fld('avatar', '头像 URL', 'Avatar URL')]),
                         act('mail', '发送换绑验证码', 'Send email code', 'profileEmailSend', 'POST'),
                         act('confirm', '确认换绑', 'Confirm email', 'profileEmailConfirm', 'POST',
                             fields=[fld('code', '验证码', 'Code')])]},
            {'id': 'password', 'l': '修改密码', 'le': 'Change password', 'icon': 'lock',
             'forms': [form('pw', '提交', 'Submit', 'passwordChange', 'POST', [
                 fld('code', '邮箱验证码', 'Email code'), fld('newPassword', '新密码', 'New password', 'secret')])],
             'actions': [act('send', '发送验证码', 'Send code', 'passwordSendCode', 'POST')]},
            {'id': 'oauth', 'l': '第三方绑定', 'le': 'Linked accounts', 'icon': 'link',
             'load': {'ep': 'githubStatus', 'items': 'github'},
             'actions': [act('gstatus', 'GitHub 状态', 'GitHub status', 'githubStatus', 'GET', load=True),
                         act('gunbind', '解绑 GitHub', 'Unbind GitHub', 'githubUnbind', 'POST', confirm=True),
                         act('gstar', '领取 Star 奖励', 'Claim star bonus', 'githubClaimStar', 'POST'),
                         act('nstatus', 'NodeLoc 状态', 'NodeLoc status', 'nodelocStatus', 'GET', load=True),
                         act('nunbind', '解绑 NodeLoc', 'Unbind NodeLoc', 'nodelocUnbind', 'POST', confirm=True)]},
            {'id': 'notif', 'l': '通知中心', 'le': 'Notifications', 'icon': 'bell',
             'load': {'ep': 'notifications', 'items': 'items'},
             'rowActions': [act('del', '删除', 'Delete', 'notificationDelete', 'DELETE', vars=['id']),
                            act('read', '标记已读', 'Mark read', 'notificationsRead', 'POST', vars=['id'])],
             'actions': [act('unread', '未读数', 'Unread', 'notificationsUnread', 'GET', load=True),
                         act('readall', '全部已读', 'Mark all read', 'notificationsReadAll', 'POST')]},
            {'id': 'browser_auth', 'l': '浏览器授权登录', 'le': 'Browser authorization',
             'icon': 'link',
             'actions': [act('issue', '领取授权码（浏览器已登录）', 'Issue code', 'appTokenIssue', 'POST'),
                         act('exchange', '用授权码登录', 'Exchange code', 'appTokenExchange', 'POST',
                             fields=[fld('code', '授权码', 'Code')])]},
            {'id': 'account_flows', 'l': '注册 / 找回 / 验证', 'le': 'Signup, recovery & verification',
             'icon': 'lock',
             'actions': [act('send', '发送验证码', 'Send code', 'verifySend', 'POST',
                             fields=[fld('email', '邮箱', 'Email'), fld('scene', '场景', 'Scene')]),
                         act('check', '校验验证码', 'Check code', 'verifyCheck', 'POST',
                             fields=[fld('email', '邮箱', 'Email'), fld('code', '验证码', 'Code')]),
                         act('token', '找回密码令牌', 'Reset token', 'resetToken', 'POST',
                             fields=[fld('email', '邮箱', 'Email')])]},
        ]},
        {'id': 'g_community', 'l': '社区与服务', 'le': 'Community', 'icon': 'forum', 'screens': [
            {'id': 'chat', 'l': '社区帖子', 'le': 'Community posts', 'icon': 'forum',
             'load': {'ep': 'chatPosts', 'items': 'items'},
             'forms': [form('post', '发帖', 'New post', 'chatPosts', 'POST', [
                 fld('title', '标题', 'Title'), fld('content', '内容', 'Content', 'area')])],
             'actions': [act('delreply', '删除回复', 'Delete reply', 'chatReplyDelete', 'DELETE',
                             fields=[fld('id', '回复 ID', 'Reply ID', 'num')])],
             'rowActions': [act('reply', '回复', 'Reply', 'chatReply', 'POST', vars=['id'],
                                fields=[fld('content', '内容', 'Content', 'area')]),
                            act('flag', '举报', 'Flag', 'chatFlag', 'POST', vars=['id']),
                            act('del', '删除', 'Delete', 'chatPostDelete', 'DELETE', vars=['id'],
                                confirm=True)]},
            {'id': 'tickets', 'l': '工单', 'le': 'Tickets', 'icon': 'support',
             'load': {'ep': 'tickets', 'items': 'items'},
             'forms': [form('new', '新建工单', 'New ticket', 'ticketCreate', 'POST', [
                 fld('subject', '主题', 'Subject'), fld('content', '内容', 'Content', 'area')])],
             'rowActions': [act('detail', '详情', 'Detail', 'ticketDetail', 'GET', vars=['id'], load=True),
                            act('reply', '回复', 'Reply', 'ticketReply', 'POST', vars=['id'],
                                fields=[fld('content', '内容', 'Content', 'area')]),
                            act('close', '关闭', 'Close', 'ticketClose', 'POST', vars=['id'], confirm=True)]},
            {'id': 'transfer', 'l': '域名转让', 'le': 'Transfer', 'icon': 'swap',
             'load': {'ep': 'transferNotice', 'items': 'notice'},
             'forms': [form('preview', '预览转让', 'Preview', 'transferPreview', 'POST', [
                 fld('subdomainId', '域名 ID', 'Domain ID', 'num'), fld('toEmail', '目标邮箱', 'Target email')]),
                       form('commit', '确认转让', 'Commit', 'transferCommit', 'POST', [
                 fld('subdomainId', '域名 ID', 'Domain ID', 'num'), fld('toEmail', '目标邮箱', 'Target email'),
                 fld('agreed', '已确认不可逆', 'I understand', 'bool')])],
             'actions': [act('mine', '转让记录', 'Transfers', 'transferMine', 'GET', load=True),
                         act('check', '检查目标账号', 'Check account', 'transferCheck', 'POST',
                             fields=[fld('email', '邮箱', 'Email')])]},
            {'id': 'abuse', 'l': '滥用举报', 'le': 'Abuse report', 'icon': 'flag',
             'load': {'ep': 'abuseMine', 'items': 'items'},
             'forms': [form('report', '提交举报', 'Submit report', 'abuse', 'POST', [
                 fld('domain', '域名', 'Domain'),
                 fld('type', '类型', 'Type', 'select', opt=[['phishing', '钓鱼'], ['malware', '恶意软件'],
                     ['spam', '垃圾邮件'], ['illegal', '违法'], ['trademark', '商标'], ['fraud', '欺诈'], ['other', '其他']]),
                 fld('description', '详细描述', 'Description', 'area'),
                 fld('evidenceUrl', '证据链接', 'Evidence URL'), fld('contactEmail', '联系邮箱', 'Contact email')])],
             'actions': []},
            {'id': 'abuse_admin', 'l': '举报管理', 'le': 'Abuse admin', 'icon': 'flag', 'admin': True,
             'load': {'ep': 'abuseAdmin', 'items': 'items'},
             'rowActions': [act('status', '更新状态', 'Set status', 'abuseAdminUpdate', 'PATCH', vars=['id'],
                                fields=[fld('status', '状态', 'Status')]),
                            act('suspend', '停用域名', 'Suspend domain', 'abuseAdminSuspend', 'POST',
                                vars=['id'], confirm=True)]},
        ]},
        {'id': 'g_external', 'l': '第三方域名', 'le': 'External domains', 'icon': 'public', 'screens': [
            {'id': 'ext', 'l': '接入外部域名', 'le': 'Connect a domain', 'icon': 'public',
             'load': {'ep': 'externalDomains', 'items': 'items'},
             'forms': [form('add', '登记域名', 'Add domain', 'externalDomains', 'POST', [
                 fld('domain', '域名', 'Domain'), fld('note', '备注', 'Note')])],
             'rowActions': [act('verify', '验证所有权', 'Verify', 'externalDomainVerify', 'POST', vars=['id']),
                            act('ns', '检查 NS', 'Check NS', 'externalDomainCheckNs', 'POST', vars=['id']),
                            act('connect', '连接', 'Connect', 'externalDomainConnect', 'POST', vars=['id']),
                            act('del', '删除', 'Delete', 'externalDomainDelete', 'DELETE', vars=['id'],
                                confirm=True)]},
            {'id': 'emailreq', 'l': '邮箱注册申请', 'le': 'Email request', 'icon': 'mail',
             'forms': [form('req', '提交申请', 'Submit', 'emailRequest', 'POST', [fld('email', '邮箱', 'Email')])],
             'actions': [act('status', '查询状态', 'Status', 'emailRequestStatus', 'GET',
                             fields=[fld('email', '邮箱', 'Email')])]},
        ]},
        {'id': 'g_admin', 'l': '管理后台', 'le': 'Admin console', 'icon': 'shield', 'admin': True, 'screens': [
            {'id': 'adm_overview', 'l': '后台概览', 'le': 'Overview', 'icon': 'shield',
             'load': {'ep': 'adminOverview', 'items': 'sections'}, 'actions': []},
            {'id': 'adm_review', 'l': '审核与域名', 'le': 'Review', 'icon': 'list',
             'load': {'ep': 'adminSubdomains', 'items': 'items'},
             'rowActions': [act('approve', '通过', 'Approve', 'adminApprove', 'POST', vars=['id']),
                            act('reject', '驳回', 'Reject', 'adminReject', 'POST', vars=['id'],
                                fields=[fld('reason', '原因', 'Reason')]),
                            act('suspend', '停用', 'Suspend', 'adminSuspend', 'POST', vars=['id'],
                                fields=[fld('reason', '原因', 'Reason')]),
                            act('restore', '恢复', 'Restore', 'adminRestore', 'POST', vars=['id']),
                            act('del', '删除', 'Delete', 'adminSubdomainDelete', 'DELETE', vars=['id'],
                                confirm=True, danger=True)]},
            {'id': 'adm_users', 'l': '用户管理', 'le': 'Users', 'icon': 'person',
             'load': {'ep': 'adminUsers', 'items': 'items'},
             'rowActions': [act('points', '调整积分', 'Set points', 'adminUserPoints', 'POST', vars=['id'],
                                fields=[fld('set', '积分', 'Points', 'num')]),
                            act('quota', '配额 / 角色', 'Quota & role', 'adminUserQuota', 'POST', vars=['id'],
                                fields=[fld('quota', '配额', 'Quota', 'num'),
                                        fld('role', '角色', 'Role', 'select', opt=[['user', '普通用户'], ['admin', '管理员']])]),
                            act('ban', '封禁', 'Ban', 'adminUserBan', 'POST', vars=['id'],
                                fields=[fld('reason', '原因', 'Reason')], confirm=True, danger=True),
                            act('unban', '解封', 'Unban', 'adminUserUnban', 'POST', vars=['id'])]},
            {'id': 'adm_ops', 'l': '锁 / 审计 / IP', 'le': 'Locks, audit & IPs', 'icon': 'lock',
             'load': {'ep': 'adminLocks', 'items': 'items'},
             'rowActions': [act('unlock', '强制解锁', 'Force unlock', 'forceUnlock', 'POST', vars=['rid']),
                            act('reconcile', 'DNS 对账', 'Reconcile', 'adminReconcile', 'POST', vars=['id'])],
             'actions': [act('audit', '审计日志', 'Audit log', 'adminAudit', 'GET', load=True),
                         act('ips', 'IP 聚合', 'IP clusters', 'adminIps', 'GET', load=True),
                         act('ipban', '封禁 IP', 'Ban IP', 'adminIpBan', 'POST',
                             fields=[fld('ip', 'IP', 'IP'), fld('reason', '原因', 'Reason')]),
                         act('ipunban', '解封 IP', 'Unban IP', 'adminIpUnban', 'POST',
                             fields=[fld('ip', 'IP', 'IP')])]},
            {'id': 'adm_review2', 'l': '第三方审核', 'le': 'Reviews', 'icon': 'list',
             'load': {'ep': 'adminExternalDomains', 'items': 'items'},
             'rowActions': [act('approve', '通过', 'Approve', 'adminExternalApprove', 'POST', vars=['id']),
                            act('reject', '驳回', 'Reject', 'adminExternalReject', 'POST', vars=['id'],
                                fields=[fld('reason', '原因', 'Reason')])],
             'actions': [act('emails', '邮箱申请', 'Email requests', 'adminEmailRequests', 'GET', load=True),
                         act('approve2', '通过邮箱', 'Approve email', 'adminEmailApprove', 'POST',
                             fields=[fld('id', 'ID', 'ID', 'num')]),
                         act('approve3', '驳回邮箱申请', 'Reject email', 'adminEmailReject', 'POST',
                             fields=[fld('id', 'ID', 'ID', 'num'), fld('reason', '原因', 'Reason')]),
                         act('allow', '加白名单', 'Add allowlist', 'adminEmailAllowlist', 'POST',
                             fields=[fld('email', '邮箱', 'Email')]),
                         act('unallow', '移除白名单', 'Remove allowlist', 'adminEmailAllowlistDelete', 'DELETE',
                             fields=[fld('email', '邮箱', 'Email')])]},
        ]},
        {'id': 'g_settings', 'l': '站点设置', 'le': 'Site settings', 'icon': 'tune',
         'admin': True, 'screens': settings_screens},
        {'id': 'g_ops', 'l': '运维与根域名', 'le': 'Operations', 'icon': 'cloud', 'admin': True, 'screens': [
            {'id': 'roots', 'l': '根域名', 'le': 'Root domains', 'icon': 'cloud',
             'load': {'ep': 'adminRoots', 'items': 'items'},
             'rowActions': [act('backend', '切换后端', 'Switch backend', 'adminRootBackend', 'POST',
                                vars=['domain'], fields=[fld('backend', '后端', 'Backend', 'select',
                                opt=[['cloudflare', 'Cloudflare'], ['anyns', 'AnyNS'],
                                     ['spaceship', 'Spaceship'], ['seus', 'SEUS']])]),
                            act('restore', '恢复', 'Restore', 'adminRootRestore', 'POST', vars=['domain']),
                            act('del', '删除', 'Delete', 'adminRootDelete', 'DELETE', vars=['domain'],
                                confirm=True, danger=True),
                            act('shipdel', '删除 Spaceship 根', 'Delete Spaceship root',
                                'adminSpaceshipRootsDelete', 'DELETE', vars=['domain'], confirm=True)],
             'actions': [act('anyns', 'AnyNS 域名', 'AnyNS domains', 'adminAnynsDomains', 'GET', load=True),
                         act('anynsadd', '添加 AnyNS 域名', 'Add AnyNS domain', 'adminAnynsAdd', 'POST',
                             fields=[fld('domain', '域名', 'Domain')]),
                         act('ship', 'Spaceship 域名', 'Spaceship domains', 'adminSpaceshipDomains', 'GET', load=True),
                         act('shipadd', '添加 Spaceship 域名', 'Add Spaceship domain', 'adminSpaceshipAdd', 'POST',
                             fields=[fld('domain', '域名', 'Domain')]),
                         act('shiptest', '测试 Spaceship', 'Test Spaceship', 'adminSpaceshipTest', 'POST')]},
            {'id': 'ai', 'l': 'AI 运维', 'le': 'AI operations', 'icon': 'sparkle',
             'actions': [act('models', '探测模型', 'Probe models', 'adminAiModels', 'POST'),
                         act('test', '连通性测试', 'Test connection', 'adminAiTest', 'POST'),
                         act('diag', '诊断', 'Diagnose', 'adminAiDiagnose', 'POST'),
                         act('run', '运行审核', 'Run review', 'adminAiReviewRun', 'POST'),
                         act('status', '审核状态', 'Review status', 'adminAiReviewStatus', 'GET', load=True)]},
            {'id': 'backup', 'l': '备份与恢复', 'le': 'Backup', 'icon': 'cloud',
             'actions': [act('exp_users', '导出用户', 'Export users', 'adminBackupExport', 'GET',
                             vars=['kind'], const={'kind': 'users'}),
                         act('exp_subs', '导出域名', 'Export domains', 'adminBackupExport', 'GET',
                             vars=['kind'], const={'kind': 'subdomains'}),
                         act('exp_set', '导出设置', 'Export settings', 'adminBackupExport', 'GET',
                             vars=['kind'], const={'kind': 'settings'}),
                         act('imp', '导入', 'Import', 'adminBackupImport', 'POST', vars=['kind'],
                             fields=[fld('kind', '类型', 'Kind'), fld('mode', '模式', 'Mode')]),
                         act('resetlogo', '重置 Logo', 'Reset logo', 'adminResetLogo', 'POST')]},
        ]},
    ]


def main():
    fields = parse_settings()
    adm = (ROOT / 'src/routes/admin.ts').read_text(encoding='utf-8')
    blk = adm[adm.index("app.post('/settings'"):adm.index("app.post('/settings/reset-logo'")]
    # 判定写法不止 !== undefined：数值走 numRule、密钥走 String(...).trim()，
    # 所以只要求字段名确实出现在 POST /settings 处理段里。
    accepted = set(re.findall(r'body\.([A-Za-z_]\w*)', blk))
    missing = [f['k'] for f in fields if f['k'] not in accepted]
    if missing:
        raise SystemExit('这些设置字段 POST /settings 里不存在：' + ', '.join(missing))

    gs = groups(build_settings_screens(fields))
    schema = {'v': 2, 'api': 'noxc-app/schema/v2', 'groups': gs}
    body = '''/**
 * Noxc App · 全站功能描述（服务端唯一真源，由 scripts/gen-app-schema.py 生成，勿手改）
 *
 * 用户要求「所有网站的功能都能在 App 里控制」。手写上百个按钮必然漏，
 * 所以这里用**声明式 schema** 描述站点全部能力：分组 → 页面 → 数据 / 表单 / 动作。
 * Android 端只写一个通用渲染器（SchemaActivity），从 /api/app/v1/schema 拉这份
 * 描述并生成原生 M3 控件；新增功能只改生成脚本，不用发版。
 *
 * 每个 ep 都是 bootstrap.endpoints 契约里的 key，App 用 Api.epXxx 做占位替换，
 * 客户端不硬编码任何 /api 路径。app-api-regression 会校验：
 *   1) schema 里所有 ep 都在契约里；2) 所有真实 API 路由都被 schema 覆盖。
 */
export interface AppScreen {
  id: string; l: string; le: string; icon: string; admin?: boolean; native?: string;
  load?: { ep: string; items: string };
  forms?: any[]; actions?: any[]; rowActions?: any[];
}

export interface AppGroup {
  id: string; l: string; le: string; icon: string; admin?: boolean;
  screens: AppScreen[];
}

/** 刻意用浅接口而不是 as const：46 页 × 74 字段的深字面量类型会让 tsc 爆栈。 */
export const APP_SCHEMA: { v: number; api: string; groups: AppGroup[] } = ''' + json.dumps(schema, ensure_ascii=False, indent=1) + ''';

/** 收集 schema 里引用的所有 endpoint key，供回归做覆盖校验。 */
export function schemaEndpointKeys(): string[] {
  const out = new Set<string>();
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (typeof o.ep === 'string') out.add(o.ep);
    for (const v of Object.values(o)) walk(v);
  };
  walk(APP_SCHEMA as any);
  return [...out];
}
'''
    (ROOT / 'src/lib/appSchema.ts').write_text(body, encoding='utf-8')
    print('✔ appSchema.ts:', len(gs), '组,', sum(len(g['screens']) for g in gs), '页,',
          len(fields), '设置字段')


if __name__ == '__main__':
    main()
