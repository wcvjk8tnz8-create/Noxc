/**
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
export const APP_SCHEMA: { v: number; api: string; groups: AppGroup[] } = {
 "v": 2,
 "api": "noxc-app/schema/v2",
 "groups": [
  {
   "id": "g_overview",
   "l": "概览与首页",
   "le": "Overview",
   "icon": "home",
   "screens": [
    {
     "id": "home",
     "l": "站点数据",
     "le": "Site stats",
     "icon": "home",
     "load": {
      "ep": "stats",
      "items": "publicStats"
     },
     "actions": [
      {
       "id": "refresh",
       "l": "刷新",
       "le": "Refresh",
       "ep": "stats",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "config",
     "l": "公开配置",
     "le": "Public config",
     "icon": "info",
     "load": {
      "ep": "config",
      "items": "site"
     },
     "actions": []
    },
    {
     "id": "terms",
     "l": "服务条款",
     "le": "Terms",
     "icon": "doc",
     "load": {
      "ep": "terms",
      "items": "terms"
     },
     "actions": []
    },
    {
     "id": "rules",
     "l": "使用规则",
     "le": "Rules",
     "icon": "doc",
     "load": {
      "ep": "rules",
      "items": "rules"
     },
     "actions": []
    },
    {
     "id": "showcase",
     "l": "用户案例墙",
     "le": "Showcase",
     "icon": "star",
     "load": {
      "ep": "showcase",
      "items": "items"
     },
     "actions": []
    }
   ]
  },
  {
   "id": "g_domain",
   "l": "域名",
   "le": "Domains",
   "icon": "domain",
   "screens": [
    {
     "id": "check",
     "l": "查询可用性",
     "le": "Check availability",
     "icon": "search",
     "forms": [
      {
       "id": "chk",
       "l": "查询",
       "le": "Check",
       "ep": "check",
       "m": "GET",
       "fields": [
        {
         "k": "label",
         "l": "名称",
         "le": "Label",
         "t": "text"
        },
        {
         "k": "root",
         "l": "后缀",
         "le": "Root",
         "t": "text"
        },
        {
         "k": "discountCode",
         "l": "优惠码",
         "le": "Discount code",
         "t": "text"
        }
       ]
      }
     ],
     "actions": []
    },
    {
     "id": "whois",
     "l": "WHOIS 查询",
     "le": "WHOIS lookup",
     "icon": "search",
     "forms": [
      {
       "id": "w",
       "l": "查询",
       "le": "Lookup",
       "ep": "whois",
       "m": "GET",
       "fields": [
        {
         "k": "name",
         "l": "域名",
         "le": "Domain",
         "t": "text"
        }
       ]
      }
     ],
     "actions": []
    },
    {
     "id": "mine",
     "l": "我的域名",
     "le": "My domains",
     "icon": "list",
     "load": {
      "ep": "mine",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "detail",
       "l": "DNS 记录",
       "le": "DNS records",
       "ep": "records",
       "m": "GET",
       "native": "domain",
       "vars": [
        "id"
       ]
      },
      {
       "id": "edit",
       "l": "修改备注",
       "le": "Edit note",
       "ep": "subdomainUpdate",
       "m": "PATCH",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "note",
         "l": "备注",
         "le": "Note",
         "t": "text"
        }
       ]
      },
      {
       "id": "renew",
       "l": "续期",
       "le": "Renew",
       "ep": "renew",
       "m": "POST",
       "vars": [
        "id"
       ],
       "confirm": true
      },
      {
       "id": "del",
       "l": "释放",
       "le": "Release",
       "ep": "subdomainDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ],
       "confirm": true,
       "danger": true
      }
     ],
     "actions": [
      {
       "id": "apply",
       "l": "申请子域名",
       "le": "Apply",
       "ep": "apply",
       "m": "POST",
       "native": "apply"
      }
     ]
    },
    {
     "id": "soa",
     "l": "SOA 信息",
     "le": "SOA record",
     "icon": "info",
     "load": {
      "ep": "soa",
      "items": "soa"
     },
     "actions": []
    },
    {
     "id": "providers",
     "l": "注册商列表",
     "le": "Registrars",
     "icon": "list",
     "load": {
      "ep": "subdomainProviders",
      "items": "items"
     },
     "actions": []
    }
   ]
  },
  {
   "id": "g_dns",
   "l": "DNS 记录",
   "le": "DNS records",
   "icon": "dns",
   "screens": [
    {
     "id": "dns",
     "l": "记录增删改",
     "le": "Records",
     "icon": "dns",
     "native": "domain",
     "load": {
      "ep": "records",
      "items": "records"
     },
     "actions": []
    },
    {
     "id": "deleg",
     "l": "NS 委派",
     "le": "NS delegation",
     "icon": "dns",
     "load": {
      "ep": "delegationProviders",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "use",
       "l": "使用此服务商",
       "le": "Use provider",
       "ep": "delegation",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "id",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        },
        {
         "k": "provider",
         "l": "标识",
         "le": "Key",
         "t": "text"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "check",
       "l": "检查委派",
       "le": "Check delegation",
       "ep": "delegationCheck",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "id",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        }
       ]
      },
      {
       "id": "alt",
       "l": "设置委派（兼容前缀）",
       "le": "Set delegation (alt)",
       "ep": "delegationAlt",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "id",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        },
        {
         "k": "provider",
         "l": "服务商",
         "le": "Provider",
         "t": "text"
        }
       ]
      },
      {
       "id": "altcheck",
       "l": "检查委派（兼容前缀）",
       "le": "Check (alt)",
       "ep": "delegationAltCheck",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "id",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "id": "g_points",
   "l": "积分与奖励",
   "le": "Points & rewards",
   "icon": "star",
   "screens": [
    {
     "id": "points",
     "l": "我的积分",
     "le": "My points",
     "icon": "star",
     "load": {
      "ep": "pointsMe",
      "items": "points"
     },
     "actions": [
      {
       "id": "checkin",
       "l": "每日签到",
       "le": "Daily check-in",
       "ep": "checkin",
       "m": "POST"
      },
      {
       "id": "cost",
       "l": "积分成本",
       "le": "Points cost",
       "ep": "pointsCost",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "rewards",
     "l": "奖励与兑换",
     "le": "Rewards",
     "icon": "gift",
     "load": {
      "ep": "rewards",
      "items": "items"
     },
     "forms": [
      {
       "id": "redeem",
       "l": "兑换码",
       "le": "Redeem",
       "ep": "redeem",
       "m": "POST",
       "fields": [
        {
         "k": "code",
         "l": "兑换码",
         "le": "Code",
         "t": "text"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "preview",
       "l": "预览兑换码",
       "le": "Preview code",
       "ep": "redeemPreview",
       "m": "GET",
       "fields": [
        {
         "k": "code",
         "l": "兑换码",
         "le": "Code",
         "t": "text"
        }
       ]
      },
      {
       "id": "mine",
       "l": "兑换记录",
       "le": "Redeem history",
       "ep": "redeemMine",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "redeem_admin",
     "l": "兑换码管理",
     "le": "Redeem codes",
     "icon": "gift",
     "admin": true,
     "load": {
      "ep": "redeemList",
      "items": "items"
     },
     "forms": [
      {
       "id": "gen",
       "l": "生成兑换码",
       "le": "Generate",
       "ep": "redeemGenerate",
       "m": "POST",
       "fields": [
        {
         "k": "count",
         "l": "数量",
         "le": "Count",
         "t": "num"
        },
        {
         "k": "points",
         "l": "积分",
         "le": "Points",
         "t": "num"
        }
       ]
      }
     ],
     "rowActions": [
      {
       "id": "toggle",
       "l": "启用 / 停用",
       "le": "Toggle",
       "ep": "redeemToggle",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "redeemDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ],
       "confirm": true,
       "danger": true
      }
     ],
     "actions": [
      {
       "id": "clear",
       "l": "清空全部兑换码",
       "le": "Delete all codes",
       "ep": "redeemAdminAllDelete",
       "m": "DELETE",
       "confirm": true,
       "danger": true
      }
     ]
    }
   ]
  },
  {
   "id": "g_account",
   "l": "账号与安全",
   "le": "Account",
   "icon": "person",
   "screens": [
    {
     "id": "me",
     "l": "登录态",
     "le": "Session",
     "icon": "person",
     "load": {
      "ep": "me",
      "items": "user"
     },
     "actions": [
      {
       "id": "logout",
       "l": "退出登录",
       "le": "Sign out",
       "ep": "logout",
       "m": "POST",
       "confirm": true
      }
     ]
    },
    {
     "id": "profile",
     "l": "个人资料",
     "le": "Profile",
     "icon": "person",
     "load": {
      "ep": "profile",
      "items": "profile"
     },
     "forms": [
      {
       "id": "save",
       "l": "保存资料",
       "le": "Save profile",
       "ep": "profile",
       "m": "PUT",
       "fields": [
        {
         "k": "nickname",
         "l": "昵称",
         "le": "Nickname",
         "t": "text"
        },
        {
         "k": "bio",
         "l": "简介",
         "le": "Bio",
         "t": "area"
        },
        {
         "k": "avatar",
         "l": "头像",
         "le": "Avatar",
         "t": "text"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "avatar",
       "l": "上传头像",
       "le": "Upload avatar",
       "ep": "profileAvatar",
       "m": "POST",
       "fields": [
        {
         "k": "avatar",
         "l": "头像 URL",
         "le": "Avatar URL",
         "t": "text"
        }
       ]
      },
      {
       "id": "mail",
       "l": "发送换绑验证码",
       "le": "Send email code",
       "ep": "profileEmailSend",
       "m": "POST"
      },
      {
       "id": "confirm",
       "l": "确认换绑",
       "le": "Confirm email",
       "ep": "profileEmailConfirm",
       "m": "POST",
       "fields": [
        {
         "k": "code",
         "l": "验证码",
         "le": "Code",
         "t": "text"
        }
       ]
      }
     ]
    },
    {
     "id": "password",
     "l": "修改密码",
     "le": "Change password",
     "icon": "lock",
     "forms": [
      {
       "id": "pw",
       "l": "提交",
       "le": "Submit",
       "ep": "passwordChange",
       "m": "POST",
       "fields": [
        {
         "k": "code",
         "l": "邮箱验证码",
         "le": "Email code",
         "t": "text"
        },
        {
         "k": "newPassword",
         "l": "新密码",
         "le": "New password",
         "t": "secret"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "send",
       "l": "发送验证码",
       "le": "Send code",
       "ep": "passwordSendCode",
       "m": "POST"
      }
     ]
    },
    {
     "id": "oauth",
     "l": "第三方绑定",
     "le": "Linked accounts",
     "icon": "link",
     "load": {
      "ep": "githubStatus",
      "items": "github"
     },
     "actions": [
      {
       "id": "gstatus",
       "l": "GitHub 状态",
       "le": "GitHub status",
       "ep": "githubStatus",
       "m": "GET",
       "load": true
      },
      {
       "id": "gunbind",
       "l": "解绑 GitHub",
       "le": "Unbind GitHub",
       "ep": "githubUnbind",
       "m": "POST",
       "confirm": true
      },
      {
       "id": "gstar",
       "l": "领取 Star 奖励",
       "le": "Claim star bonus",
       "ep": "githubClaimStar",
       "m": "POST"
      },
      {
       "id": "nstatus",
       "l": "NodeLoc 状态",
       "le": "NodeLoc status",
       "ep": "nodelocStatus",
       "m": "GET",
       "load": true
      },
      {
       "id": "nunbind",
       "l": "解绑 NodeLoc",
       "le": "Unbind NodeLoc",
       "ep": "nodelocUnbind",
       "m": "POST",
       "confirm": true
      }
     ]
    },
    {
     "id": "notif",
     "l": "通知中心",
     "le": "Notifications",
     "icon": "bell",
     "load": {
      "ep": "notifications",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "notificationDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ]
      },
      {
       "id": "read",
       "l": "标记已读",
       "le": "Mark read",
       "ep": "notificationsRead",
       "m": "POST",
       "vars": [
        "id"
       ]
      }
     ],
     "actions": [
      {
       "id": "unread",
       "l": "未读数",
       "le": "Unread",
       "ep": "notificationsUnread",
       "m": "GET",
       "load": true
      },
      {
       "id": "readall",
       "l": "全部已读",
       "le": "Mark all read",
       "ep": "notificationsReadAll",
       "m": "POST"
      }
     ]
    },
    {
     "id": "browser_auth",
     "l": "浏览器授权登录",
     "le": "Browser authorization",
     "icon": "link",
     "actions": [
      {
       "id": "issue",
       "l": "领取授权码（浏览器已登录）",
       "le": "Issue code",
       "ep": "appTokenIssue",
       "m": "POST"
      },
      {
       "id": "exchange",
       "l": "用授权码登录",
       "le": "Exchange code",
       "ep": "appTokenExchange",
       "m": "POST",
       "fields": [
        {
         "k": "code",
         "l": "授权码",
         "le": "Code",
         "t": "text"
        }
       ]
      }
     ]
    },
    {
     "id": "account_flows",
     "l": "注册 / 找回 / 验证",
     "le": "Signup, recovery & verification",
     "icon": "lock",
     "actions": [
      {
       "id": "send",
       "l": "发送验证码",
       "le": "Send code",
       "ep": "verifySend",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        },
        {
         "k": "scene",
         "l": "场景",
         "le": "Scene",
         "t": "text"
        }
       ]
      },
      {
       "id": "check",
       "l": "校验验证码",
       "le": "Check code",
       "ep": "verifyCheck",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        },
        {
         "k": "code",
         "l": "验证码",
         "le": "Code",
         "t": "text"
        }
       ]
      },
      {
       "id": "token",
       "l": "找回密码令牌",
       "le": "Reset token",
       "ep": "resetToken",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "id": "g_community",
   "l": "社区与服务",
   "le": "Community",
   "icon": "forum",
   "screens": [
    {
     "id": "chat",
     "l": "社区帖子",
     "le": "Community posts",
     "icon": "forum",
     "load": {
      "ep": "chatPosts",
      "items": "items"
     },
     "forms": [
      {
       "id": "post",
       "l": "发帖",
       "le": "New post",
       "ep": "chatPosts",
       "m": "POST",
       "fields": [
        {
         "k": "title",
         "l": "标题",
         "le": "Title",
         "t": "text"
        },
        {
         "k": "content",
         "l": "内容",
         "le": "Content",
         "t": "area"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "delreply",
       "l": "删除回复",
       "le": "Delete reply",
       "ep": "chatReplyDelete",
       "m": "DELETE",
       "fields": [
        {
         "k": "id",
         "l": "回复 ID",
         "le": "Reply ID",
         "t": "num"
        }
       ]
      }
     ],
     "rowActions": [
      {
       "id": "reply",
       "l": "回复",
       "le": "Reply",
       "ep": "chatReply",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "content",
         "l": "内容",
         "le": "Content",
         "t": "area"
        }
       ]
      },
      {
       "id": "flag",
       "l": "举报",
       "le": "Flag",
       "ep": "chatFlag",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "chatPostDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ],
       "confirm": true
      }
     ]
    },
    {
     "id": "tickets",
     "l": "工单",
     "le": "Tickets",
     "icon": "support",
     "load": {
      "ep": "tickets",
      "items": "items"
     },
     "forms": [
      {
       "id": "new",
       "l": "新建工单",
       "le": "New ticket",
       "ep": "ticketCreate",
       "m": "POST",
       "fields": [
        {
         "k": "subject",
         "l": "主题",
         "le": "Subject",
         "t": "text"
        },
        {
         "k": "content",
         "l": "内容",
         "le": "Content",
         "t": "area"
        }
       ]
      }
     ],
     "rowActions": [
      {
       "id": "detail",
       "l": "详情",
       "le": "Detail",
       "ep": "ticketDetail",
       "m": "GET",
       "vars": [
        "id"
       ],
       "load": true
      },
      {
       "id": "reply",
       "l": "回复",
       "le": "Reply",
       "ep": "ticketReply",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "content",
         "l": "内容",
         "le": "Content",
         "t": "area"
        }
       ]
      },
      {
       "id": "close",
       "l": "关闭",
       "le": "Close",
       "ep": "ticketClose",
       "m": "POST",
       "vars": [
        "id"
       ],
       "confirm": true
      }
     ]
    },
    {
     "id": "transfer",
     "l": "域名转让",
     "le": "Transfer",
     "icon": "swap",
     "load": {
      "ep": "transferNotice",
      "items": "notice"
     },
     "forms": [
      {
       "id": "preview",
       "l": "预览转让",
       "le": "Preview",
       "ep": "transferPreview",
       "m": "POST",
       "fields": [
        {
         "k": "subdomainId",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        },
        {
         "k": "toEmail",
         "l": "目标邮箱",
         "le": "Target email",
         "t": "text"
        }
       ]
      },
      {
       "id": "commit",
       "l": "确认转让",
       "le": "Commit",
       "ep": "transferCommit",
       "m": "POST",
       "fields": [
        {
         "k": "subdomainId",
         "l": "域名 ID",
         "le": "Domain ID",
         "t": "num"
        },
        {
         "k": "toEmail",
         "l": "目标邮箱",
         "le": "Target email",
         "t": "text"
        },
        {
         "k": "agreed",
         "l": "已确认不可逆",
         "le": "I understand",
         "t": "bool"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "mine",
       "l": "转让记录",
       "le": "Transfers",
       "ep": "transferMine",
       "m": "GET",
       "load": true
      },
      {
       "id": "check",
       "l": "检查目标账号",
       "le": "Check account",
       "ep": "transferCheck",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      }
     ]
    },
    {
     "id": "abuse",
     "l": "滥用举报",
     "le": "Abuse report",
     "icon": "flag",
     "load": {
      "ep": "abuseMine",
      "items": "items"
     },
     "forms": [
      {
       "id": "report",
       "l": "提交举报",
       "le": "Submit report",
       "ep": "abuse",
       "m": "POST",
       "fields": [
        {
         "k": "domain",
         "l": "域名",
         "le": "Domain",
         "t": "text"
        },
        {
         "k": "type",
         "l": "类型",
         "le": "Type",
         "t": "select",
         "opt": [
          [
           "phishing",
           "钓鱼"
          ],
          [
           "malware",
           "恶意软件"
          ],
          [
           "spam",
           "垃圾邮件"
          ],
          [
           "illegal",
           "违法"
          ],
          [
           "trademark",
           "商标"
          ],
          [
           "fraud",
           "欺诈"
          ],
          [
           "other",
           "其他"
          ]
         ]
        },
        {
         "k": "description",
         "l": "详细描述",
         "le": "Description",
         "t": "area"
        },
        {
         "k": "evidenceUrl",
         "l": "证据链接",
         "le": "Evidence URL",
         "t": "text"
        },
        {
         "k": "contactEmail",
         "l": "联系邮箱",
         "le": "Contact email",
         "t": "text"
        }
       ]
      }
     ],
     "actions": []
    },
    {
     "id": "abuse_admin",
     "l": "举报管理",
     "le": "Abuse admin",
     "icon": "flag",
     "admin": true,
     "load": {
      "ep": "abuseAdmin",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "status",
       "l": "更新状态",
       "le": "Set status",
       "ep": "abuseAdminUpdate",
       "m": "PATCH",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "status",
         "l": "状态",
         "le": "Status",
         "t": "text"
        }
       ]
      },
      {
       "id": "suspend",
       "l": "停用域名",
       "le": "Suspend domain",
       "ep": "abuseAdminSuspend",
       "m": "POST",
       "vars": [
        "id"
       ],
       "confirm": true
      }
     ]
    }
   ]
  },
  {
   "id": "g_external",
   "l": "第三方域名",
   "le": "External domains",
   "icon": "public",
   "screens": [
    {
     "id": "ext",
     "l": "接入外部域名",
     "le": "Connect a domain",
     "icon": "public",
     "load": {
      "ep": "externalDomains",
      "items": "items"
     },
     "forms": [
      {
       "id": "add",
       "l": "登记域名",
       "le": "Add domain",
       "ep": "externalDomains",
       "m": "POST",
       "fields": [
        {
         "k": "domain",
         "l": "域名",
         "le": "Domain",
         "t": "text"
        },
        {
         "k": "note",
         "l": "备注",
         "le": "Note",
         "t": "text"
        }
       ]
      }
     ],
     "rowActions": [
      {
       "id": "verify",
       "l": "验证所有权",
       "le": "Verify",
       "ep": "externalDomainVerify",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "ns",
       "l": "检查 NS",
       "le": "Check NS",
       "ep": "externalDomainCheckNs",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "connect",
       "l": "连接",
       "le": "Connect",
       "ep": "externalDomainConnect",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "externalDomainDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ],
       "confirm": true
      }
     ]
    },
    {
     "id": "emailreq",
     "l": "邮箱注册申请",
     "le": "Email request",
     "icon": "mail",
     "forms": [
      {
       "id": "req",
       "l": "提交申请",
       "le": "Submit",
       "ep": "emailRequest",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "status",
       "l": "查询状态",
       "le": "Status",
       "ep": "emailRequestStatus",
       "m": "GET",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "id": "g_admin",
   "l": "管理后台",
   "le": "Admin console",
   "icon": "shield",
   "admin": true,
   "screens": [
    {
     "id": "adm_overview",
     "l": "后台概览",
     "le": "Overview",
     "icon": "shield",
     "load": {
      "ep": "adminOverview",
      "items": "sections"
     },
     "actions": []
    },
    {
     "id": "adm_review",
     "l": "审核与域名",
     "le": "Review",
     "icon": "list",
     "load": {
      "ep": "adminSubdomains",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "approve",
       "l": "通过",
       "le": "Approve",
       "ep": "adminApprove",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "reject",
       "l": "驳回",
       "le": "Reject",
       "ep": "adminReject",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ]
      },
      {
       "id": "suspend",
       "l": "停用",
       "le": "Suspend",
       "ep": "adminSuspend",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ]
      },
      {
       "id": "restore",
       "l": "恢复",
       "le": "Restore",
       "ep": "adminRestore",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "adminSubdomainDelete",
       "m": "DELETE",
       "vars": [
        "id"
       ],
       "confirm": true,
       "danger": true
      }
     ]
    },
    {
     "id": "adm_users",
     "l": "用户管理",
     "le": "Users",
     "icon": "person",
     "load": {
      "ep": "adminUsers",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "points",
       "l": "调整积分",
       "le": "Set points",
       "ep": "adminUserPoints",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "set",
         "l": "积分",
         "le": "Points",
         "t": "num"
        }
       ]
      },
      {
       "id": "quota",
       "l": "配额 / 角色",
       "le": "Quota & role",
       "ep": "adminUserQuota",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "quota",
         "l": "配额",
         "le": "Quota",
         "t": "num"
        },
        {
         "k": "role",
         "l": "角色",
         "le": "Role",
         "t": "select",
         "opt": [
          [
           "user",
           "普通用户"
          ],
          [
           "admin",
           "管理员"
          ]
         ]
        }
       ]
      },
      {
       "id": "ban",
       "l": "封禁",
       "le": "Ban",
       "ep": "adminUserBan",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ],
       "confirm": true,
       "danger": true
      },
      {
       "id": "unban",
       "l": "解封",
       "le": "Unban",
       "ep": "adminUserUnban",
       "m": "POST",
       "vars": [
        "id"
       ]
      }
     ]
    },
    {
     "id": "adm_ops",
     "l": "锁 / 审计 / IP",
     "le": "Locks, audit & IPs",
     "icon": "lock",
     "load": {
      "ep": "adminLocks",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "unlock",
       "l": "强制解锁",
       "le": "Force unlock",
       "ep": "forceUnlock",
       "m": "POST",
       "vars": [
        "rid"
       ]
      },
      {
       "id": "reconcile",
       "l": "DNS 对账",
       "le": "Reconcile",
       "ep": "adminReconcile",
       "m": "POST",
       "vars": [
        "id"
       ]
      }
     ],
     "actions": [
      {
       "id": "audit",
       "l": "审计日志",
       "le": "Audit log",
       "ep": "adminAudit",
       "m": "GET",
       "load": true
      },
      {
       "id": "ips",
       "l": "IP 聚合",
       "le": "IP clusters",
       "ep": "adminIps",
       "m": "GET",
       "load": true
      },
      {
       "id": "ipban",
       "l": "封禁 IP",
       "le": "Ban IP",
       "ep": "adminIpBan",
       "m": "POST",
       "fields": [
        {
         "k": "ip",
         "l": "IP",
         "le": "IP",
         "t": "text"
        },
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ]
      },
      {
       "id": "ipunban",
       "l": "解封 IP",
       "le": "Unban IP",
       "ep": "adminIpUnban",
       "m": "POST",
       "fields": [
        {
         "k": "ip",
         "l": "IP",
         "le": "IP",
         "t": "text"
        }
       ]
      }
     ]
    },
    {
     "id": "adm_review2",
     "l": "第三方审核",
     "le": "Reviews",
     "icon": "list",
     "load": {
      "ep": "adminExternalDomains",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "approve",
       "l": "通过",
       "le": "Approve",
       "ep": "adminExternalApprove",
       "m": "POST",
       "vars": [
        "id"
       ]
      },
      {
       "id": "reject",
       "l": "驳回",
       "le": "Reject",
       "ep": "adminExternalReject",
       "m": "POST",
       "vars": [
        "id"
       ],
       "fields": [
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "emails",
       "l": "邮箱申请",
       "le": "Email requests",
       "ep": "adminEmailRequests",
       "m": "GET",
       "load": true
      },
      {
       "id": "approve2",
       "l": "通过邮箱",
       "le": "Approve email",
       "ep": "adminEmailApprove",
       "m": "POST",
       "fields": [
        {
         "k": "id",
         "l": "ID",
         "le": "ID",
         "t": "num"
        }
       ]
      },
      {
       "id": "approve3",
       "l": "驳回邮箱申请",
       "le": "Reject email",
       "ep": "adminEmailReject",
       "m": "POST",
       "fields": [
        {
         "k": "id",
         "l": "ID",
         "le": "ID",
         "t": "num"
        },
        {
         "k": "reason",
         "l": "原因",
         "le": "Reason",
         "t": "text"
        }
       ]
      },
      {
       "id": "allow",
       "l": "加白名单",
       "le": "Add allowlist",
       "ep": "adminEmailAllowlist",
       "m": "POST",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      },
      {
       "id": "unallow",
       "l": "移除白名单",
       "le": "Remove allowlist",
       "ep": "adminEmailAllowlistDelete",
       "m": "DELETE",
       "fields": [
        {
         "k": "email",
         "l": "邮箱",
         "le": "Email",
         "t": "text"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "id": "g_settings",
   "l": "站点设置",
   "le": "Site settings",
   "icon": "tune",
   "admin": true,
   "screens": [
    {
     "id": "set_0",
     "l": "站点与外观",
     "le": "Appearance",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "siteName",
         "raw": "site_name",
         "t": "text",
         "l": "站点名称",
         "le": "Site name",
         "g": "0"
        },
        {
         "k": "logoUrl",
         "raw": "logo_url",
         "t": "text",
         "l": "Logo 地址",
         "le": "Logo URL",
         "g": "0"
        },
        {
         "k": "faviconUrl",
         "raw": "favicon_url",
         "t": "text",
         "l": "Favicon 地址",
         "le": "Favicon URL",
         "g": "0"
        },
        {
         "k": "announcement",
         "raw": "announcement",
         "t": "area",
         "l": "站点公告",
         "le": "Announcement",
         "g": "0"
        },
        {
         "k": "reservedLabels",
         "raw": "reserved_labels",
         "t": "area",
         "l": "额外保留名称",
         "le": "Reserved labels",
         "g": "0"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_1",
     "l": "注册与验证",
     "le": "Signup & verification",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "captchaEnabled",
         "raw": "captcha_enabled",
         "t": "bool",
         "l": "注册滑块验证",
         "le": "Slider captcha",
         "g": "1"
        },
        {
         "k": "captchaImages",
         "raw": "captcha_images",
         "t": "text",
         "l": "滑块图库",
         "le": "Slider images",
         "g": "1"
        },
        {
         "k": "mailVerifyRequired",
         "raw": "mail_verify_required",
         "t": "bool",
         "l": "注册需邮箱验证码",
         "le": "Require email code",
         "g": "1"
        },
        {
         "k": "emailRule",
         "raw": "email_rule",
         "t": "text",
         "l": "注册邮箱规则",
         "le": "Signup email rule",
         "g": "1"
        },
        {
         "k": "maxAccountsPerIp",
         "raw": "max_accounts_per_ip",
         "t": "num",
         "l": "每 IP 账号上限",
         "le": "Max accounts per IP",
         "g": "1"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_2",
     "l": "积分与配额",
     "le": "Points & quota",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "initialPoints",
         "raw": "initial_points",
         "t": "num",
         "l": "初始积分",
         "le": "Initial points",
         "g": "2"
        },
        {
         "k": "checkinPoints",
         "raw": "checkin_points",
         "t": "num",
         "l": "签到积分",
         "le": "Check-in points",
         "g": "2"
        },
        {
         "k": "domainCost",
         "raw": "domain_cost",
         "t": "num",
         "l": "域名积分消耗",
         "le": "Domain cost",
         "g": "2"
        },
        {
         "k": "shortDomainCost",
         "raw": "short_domain_cost",
         "t": "num",
         "l": "短域名消耗",
         "le": "Short domain cost",
         "g": "2"
        },
        {
         "k": "shortDomainLen",
         "raw": "short_domain_len",
         "t": "num",
         "l": "短域名长度阈值",
         "le": "Short label length",
         "g": "2"
        },
        {
         "k": "comboRewardPoints",
         "raw": "combo_reward_points",
         "t": "num",
         "l": "连续签到奖励",
         "le": "Combo reward",
         "g": "2"
        },
        {
         "k": "showcaseRewardPoints",
         "raw": "showcase_reward_points",
         "t": "num",
         "l": "案例展示奖励",
         "le": "Showcase reward",
         "g": "2"
        },
        {
         "k": "rootPointCosts",
         "raw": "root_point_costs",
         "t": "area",
         "l": "后缀积分成本",
         "le": "Per-root costs",
         "g": "2"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_3",
     "l": "域名与有效期",
     "le": "Domains & expiry",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "defaultQuota",
         "raw": "default_quota",
         "t": "num",
         "l": "默认配额",
         "le": "Default quota",
         "g": "3"
        },
        {
         "k": "domainValidDays",
         "raw": "domain_valid_days",
         "t": "num",
         "l": "域名有效天数",
         "le": "Valid days",
         "g": "3"
        },
        {
         "k": "renewWindowDays",
         "raw": "renew_window_days",
         "t": "num",
         "l": "续期窗口（天）",
         "le": "Renew window",
         "g": "3"
        },
        {
         "k": "rootRegLimits",
         "raw": "root_reg_limits",
         "t": "area",
         "l": "后缀注册上限",
         "le": "Per-root limits",
         "g": "3"
        },
        {
         "k": "applyPaused",
         "raw": "apply_paused",
         "t": "bool",
         "l": "暂停新申请",
         "le": "Pause applications",
         "g": "3"
        },
        {
         "k": "applyPausedMessage",
         "raw": "apply_paused_message",
         "t": "area",
         "l": "暂停提示",
         "le": "Pause notice",
         "g": "3"
        },
        {
         "k": "rootApplyPaused",
         "raw": "root_apply_paused",
         "t": "area",
         "l": "按后缀暂停",
         "le": "Per-root pause",
         "g": "3"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_4",
     "l": "邮件与通知",
     "le": "Mail & notices",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "mailProvider",
         "raw": "mail_provider",
         "t": "select",
         "l": "邮件服务商",
         "le": "Mail provider",
         "g": "4",
         "opt": [
          [
           "resend",
           "Resend"
          ],
          [
           "smtp",
           "SMTP"
          ],
          [
           "mailgun",
           "Mailgun"
          ],
          [
           "",
           "未配置"
          ]
         ]
        },
        {
         "k": "mailFrom",
         "raw": "mail_from",
         "t": "text",
         "l": "发件人",
         "le": "Mail from",
         "g": "4"
        },
        {
         "k": "mailApiKey",
         "raw": "mail_api_key",
         "t": "secret",
         "l": "邮件 API Key",
         "le": "Mail API key",
         "g": "4"
        },
        {
         "k": "abuseEmail",
         "raw": "abuse_email",
         "t": "text",
         "l": "滥用投诉邮箱",
         "le": "Abuse email",
         "g": "4"
        },
        {
         "k": "abuseReportUrl",
         "raw": "abuse_report_url",
         "t": "text",
         "l": "外部举报入口",
         "le": "Abuse report URL",
         "g": "4"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_5",
     "l": "DNS 与服务商",
     "le": "DNS providers",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "dnsApiUrl",
         "raw": "dns_api_url",
         "t": "text",
         "l": "DNS API 地址",
         "le": "DNS API URL",
         "g": "5"
        },
        {
         "k": "dnsApiKey",
         "raw": "dns_api_key",
         "t": "secret",
         "l": "DNS API Key",
         "le": "DNS API key",
         "g": "5"
        },
        {
         "k": "dnsApiSecret",
         "raw": "dns_api_secret",
         "t": "secret",
         "l": "DNS API Secret",
         "le": "DNS API secret",
         "g": "5"
        },
        {
         "k": "dnsheApiKey",
         "raw": "dnshe_api_key",
         "t": "secret",
         "l": "DNSHE Key",
         "le": "DNSHE key",
         "g": "5"
        },
        {
         "k": "dnsheApiSecret",
         "raw": "dnshe_api_secret",
         "t": "secret",
         "l": "DNSHE Secret",
         "le": "DNSHE secret",
         "g": "5"
        },
        {
         "k": "spaceshipApiUrl",
         "raw": "spaceship_api_url",
         "t": "text",
         "l": "Spaceship API",
         "le": "Spaceship API",
         "g": "5"
        },
        {
         "k": "spaceshipApiKey",
         "raw": "spaceship_api_key",
         "t": "secret",
         "l": "Spaceship Key",
         "le": "Spaceship key",
         "g": "5"
        },
        {
         "k": "spaceshipApiSecret",
         "raw": "spaceship_api_secret",
         "t": "secret",
         "l": "Spaceship Secret",
         "le": "Spaceship secret",
         "g": "5"
        },
        {
         "k": "dnsPausedRoots",
         "raw": "dns_paused_roots",
         "t": "area",
         "l": "暂停解析后缀",
         "le": "DNS-paused roots",
         "g": "5"
        },
        {
         "k": "dnsMigrationNotice",
         "raw": "dns_migration_notice",
         "t": "area",
         "l": "迁移公告",
         "le": "Migration notice",
         "g": "5"
        },
        {
         "k": "r2PublicUrl",
         "raw": "r2_public_url",
         "t": "text",
         "l": "R2 公共资源地址",
         "le": "R2 public URL",
         "g": "5"
        },
        {
         "k": "hostingPanelDomain",
         "raw": "hosting_panel_domain",
         "t": "text",
         "l": "主机面板域名",
         "le": "Hosting panel domain",
         "g": "5"
        },
        {
         "k": "hostingPanelName",
         "raw": "hosting_panel_name",
         "t": "text",
         "l": "主机面板名称",
         "le": "Hosting panel name",
         "g": "5"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_6",
     "l": "AI 审核",
     "le": "AI review",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "aiEnabled",
         "raw": "ai_review_enabled",
         "t": "bool",
         "l": "AI 自动审核",
         "le": "AI review",
         "g": "6"
        },
        {
         "k": "aiRoots",
         "raw": "ai_review_roots",
         "t": "area",
         "l": "AI 审核后缀",
         "le": "AI review roots",
         "g": "6"
        },
        {
         "k": "aiDnsUnlimitedRoots",
         "raw": "dns_unlimited_roots",
         "t": "area",
         "l": "不限记录数后缀",
         "le": "Unlimited-record roots",
         "g": "6"
        },
        {
         "k": "aiProvider",
         "raw": "ai_provider",
         "t": "select",
         "l": "AI 服务商",
         "le": "AI provider",
         "g": "6",
         "opt": [
          [
           "openai",
           "OpenAI 兼容"
          ],
          [
           "workers-ai",
           "Workers AI"
          ],
          [
           "",
           "未配置"
          ]
         ]
        },
        {
         "k": "aiUrl",
         "raw": "ai_api_url",
         "t": "text",
         "l": "AI API 地址",
         "le": "AI API URL",
         "g": "6"
        },
        {
         "k": "aiEndpointMode",
         "raw": "ai_endpoint_mode",
         "t": "select",
         "l": "AI 接口模式",
         "le": "AI endpoint mode",
         "g": "6",
         "opt": [
          [
           "chat",
           "/chat/completions"
          ],
          [
           "responses",
           "/responses"
          ],
          [
           "auto",
           "自动"
          ]
         ]
        },
        {
         "k": "aiModel",
         "raw": "ai_model",
         "t": "text",
         "l": "AI 模型",
         "le": "AI model",
         "g": "6"
        },
        {
         "k": "aiApiKey",
         "raw": "ai_api_key",
         "t": "secret",
         "l": "AI API Key",
         "le": "AI API key",
         "g": "6"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_7",
     "l": "第三方登录",
     "le": "OAuth",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "nodelocEnabled",
         "raw": "nodeloc_enabled",
         "t": "bool",
         "l": "NodeLoc 登录",
         "le": "NodeLoc login",
         "g": "7"
        },
        {
         "k": "nodelocClientId",
         "raw": "nodeloc_client_id",
         "t": "text",
         "l": "NodeLoc Client ID",
         "le": "NodeLoc client ID",
         "g": "7"
        },
        {
         "k": "nodelocClientSecret",
         "raw": "nodeloc_client_secret",
         "t": "secret",
         "l": "NodeLoc Secret",
         "le": "NodeLoc secret",
         "g": "7"
        },
        {
         "k": "nodelocAutoRegister",
         "raw": "nodeloc_auto_register",
         "t": "bool",
         "l": "NodeLoc 自动注册",
         "le": "NodeLoc auto-register",
         "g": "7"
        },
        {
         "k": "nodelocRedirectUri",
         "raw": "nodeloc_redirect_uri",
         "t": "text",
         "l": "NodeLoc 回调",
         "le": "NodeLoc redirect URI",
         "g": "7"
        },
        {
         "k": "githubEnabled",
         "raw": "github_enabled",
         "t": "bool",
         "l": "GitHub 登录",
         "le": "GitHub login",
         "g": "7"
        },
        {
         "k": "githubClientId",
         "raw": "github_client_id",
         "t": "text",
         "l": "GitHub Client ID",
         "le": "GitHub client ID",
         "g": "7"
        },
        {
         "k": "githubClientSecret",
         "raw": "github_client_secret",
         "t": "secret",
         "l": "GitHub Secret",
         "le": "GitHub secret",
         "g": "7"
        },
        {
         "k": "githubAutoRegister",
         "raw": "github_auto_register",
         "t": "bool",
         "l": "GitHub 自动注册",
         "le": "GitHub auto-register",
         "g": "7"
        },
        {
         "k": "githubRedirectUri",
         "raw": "github_redirect_uri",
         "t": "text",
         "l": "GitHub 回调",
         "le": "GitHub redirect URI",
         "g": "7"
        },
        {
         "k": "githubStarRepo",
         "raw": "github_star_repo",
         "t": "text",
         "l": "Star 仓库",
         "le": "Star repo",
         "g": "7"
        },
        {
         "k": "githubStarBonus",
         "raw": "github_star_bonus",
         "t": "num",
         "l": "Star 奖励积分",
         "le": "Star bonus",
         "g": "7"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_8",
     "l": "第三方域名",
     "le": "External domains",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "anynsRoots",
         "raw": "anyns_roots",
         "t": "area",
         "l": "AnyNS 后缀",
         "le": "AnyNS roots",
         "g": "8"
        },
        {
         "k": "anynsZoneId",
         "raw": "anyns_zone_id",
         "t": "text",
         "l": "AnyNS Zone ID",
         "le": "AnyNS zone ID",
         "g": "8"
        },
        {
         "k": "anynsZoneIds",
         "raw": "anyns_zone_ids",
         "t": "area",
         "l": "AnyNS Zone 映射",
         "le": "AnyNS zone map",
         "g": "8"
        },
        {
         "k": "anynsApiToken",
         "raw": "anyns_api_token",
         "t": "secret",
         "l": "AnyNS Token",
         "le": "AnyNS token",
         "g": "8"
        },
        {
         "k": "seusZoneIds",
         "raw": "seus_zone_ids",
         "t": "area",
         "l": "SEUS Zone 映射",
         "le": "SEUS zone map",
         "g": "8"
        },
        {
         "k": "seusApiToken",
         "raw": "seus_api_token",
         "t": "secret",
         "l": "SEUS Token",
         "le": "SEUS token",
         "g": "8"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_9",
     "l": "页脚与合规",
     "le": "Footer & legal",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "footerIcpHtml",
         "raw": "footer_icp_html",
         "t": "area",
         "l": "页脚备案号",
         "le": "Footer ICP",
         "g": "9"
        },
        {
         "k": "footerContactHtml",
         "raw": "footer_contact_html",
         "t": "area",
         "l": "页脚联系方式",
         "le": "Footer contact",
         "g": "9"
        },
        {
         "k": "whoisHolder",
         "raw": "whois_holder",
         "t": "text",
         "l": "WHOIS 持有人",
         "le": "WHOIS holder",
         "g": "9"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "set_10",
     "l": "字体与展示",
     "le": "Fonts & display",
     "icon": "tune",
     "admin": true,
     "forms": [
      {
       "id": "f",
       "l": "保存设置",
       "le": "Save changes",
       "ep": "adminSettings",
       "m": "POST",
       "fields": [
        {
         "k": "fontBody",
         "raw": "font_body",
         "t": "text",
         "l": "正文字体",
         "le": "Body font",
         "g": "10"
        },
        {
         "k": "fontDisplay",
         "raw": "font_display",
         "t": "text",
         "l": "标题字体",
         "le": "Display font",
         "g": "10"
        }
       ]
      }
     ],
     "actions": [
      {
       "id": "reload",
       "l": "重新读取",
       "le": "Reload",
       "ep": "adminSettings",
       "m": "GET",
       "load": true
      }
     ]
    }
   ]
  },
  {
   "id": "g_ops",
   "l": "运维与根域名",
   "le": "Operations",
   "icon": "cloud",
   "admin": true,
   "screens": [
    {
     "id": "roots",
     "l": "根域名",
     "le": "Root domains",
     "icon": "cloud",
     "load": {
      "ep": "adminRoots",
      "items": "items"
     },
     "rowActions": [
      {
       "id": "backend",
       "l": "切换后端",
       "le": "Switch backend",
       "ep": "adminRootBackend",
       "m": "POST",
       "vars": [
        "domain"
       ],
       "fields": [
        {
         "k": "backend",
         "l": "后端",
         "le": "Backend",
         "t": "select",
         "opt": [
          [
           "cloudflare",
           "Cloudflare"
          ],
          [
           "anyns",
           "AnyNS"
          ],
          [
           "spaceship",
           "Spaceship"
          ],
          [
           "seus",
           "SEUS"
          ]
         ]
        }
       ]
      },
      {
       "id": "restore",
       "l": "恢复",
       "le": "Restore",
       "ep": "adminRootRestore",
       "m": "POST",
       "vars": [
        "domain"
       ]
      },
      {
       "id": "del",
       "l": "删除",
       "le": "Delete",
       "ep": "adminRootDelete",
       "m": "DELETE",
       "vars": [
        "domain"
       ],
       "confirm": true,
       "danger": true
      },
      {
       "id": "shipdel",
       "l": "删除 Spaceship 根",
       "le": "Delete Spaceship root",
       "ep": "adminSpaceshipRootsDelete",
       "m": "DELETE",
       "vars": [
        "domain"
       ],
       "confirm": true
      }
     ],
     "actions": [
      {
       "id": "anyns",
       "l": "AnyNS 域名",
       "le": "AnyNS domains",
       "ep": "adminAnynsDomains",
       "m": "GET",
       "load": true
      },
      {
       "id": "anynsadd",
       "l": "添加 AnyNS 域名",
       "le": "Add AnyNS domain",
       "ep": "adminAnynsAdd",
       "m": "POST",
       "fields": [
        {
         "k": "domain",
         "l": "域名",
         "le": "Domain",
         "t": "text"
        }
       ]
      },
      {
       "id": "ship",
       "l": "Spaceship 域名",
       "le": "Spaceship domains",
       "ep": "adminSpaceshipDomains",
       "m": "GET",
       "load": true
      },
      {
       "id": "shipadd",
       "l": "添加 Spaceship 域名",
       "le": "Add Spaceship domain",
       "ep": "adminSpaceshipAdd",
       "m": "POST",
       "fields": [
        {
         "k": "domain",
         "l": "域名",
         "le": "Domain",
         "t": "text"
        }
       ]
      },
      {
       "id": "shiptest",
       "l": "测试 Spaceship",
       "le": "Test Spaceship",
       "ep": "adminSpaceshipTest",
       "m": "POST"
      }
     ]
    },
    {
     "id": "ai",
     "l": "AI 运维",
     "le": "AI operations",
     "icon": "sparkle",
     "actions": [
      {
       "id": "models",
       "l": "探测模型",
       "le": "Probe models",
       "ep": "adminAiModels",
       "m": "POST"
      },
      {
       "id": "test",
       "l": "连通性测试",
       "le": "Test connection",
       "ep": "adminAiTest",
       "m": "POST"
      },
      {
       "id": "diag",
       "l": "诊断",
       "le": "Diagnose",
       "ep": "adminAiDiagnose",
       "m": "POST"
      },
      {
       "id": "run",
       "l": "运行审核",
       "le": "Run review",
       "ep": "adminAiReviewRun",
       "m": "POST"
      },
      {
       "id": "status",
       "l": "审核状态",
       "le": "Review status",
       "ep": "adminAiReviewStatus",
       "m": "GET",
       "load": true
      }
     ]
    },
    {
     "id": "backup",
     "l": "备份与恢复",
     "le": "Backup",
     "icon": "cloud",
     "actions": [
      {
       "id": "exp_users",
       "l": "导出用户",
       "le": "Export users",
       "ep": "adminBackupExport",
       "m": "GET",
       "vars": [
        "kind"
       ],
       "const": {
        "kind": "users"
       }
      },
      {
       "id": "exp_subs",
       "l": "导出域名",
       "le": "Export domains",
       "ep": "adminBackupExport",
       "m": "GET",
       "vars": [
        "kind"
       ],
       "const": {
        "kind": "subdomains"
       }
      },
      {
       "id": "exp_set",
       "l": "导出设置",
       "le": "Export settings",
       "ep": "adminBackupExport",
       "m": "GET",
       "vars": [
        "kind"
       ],
       "const": {
        "kind": "settings"
       }
      },
      {
       "id": "imp",
       "l": "导入",
       "le": "Import",
       "ep": "adminBackupImport",
       "m": "POST",
       "vars": [
        "kind"
       ],
       "fields": [
        {
         "k": "kind",
         "l": "类型",
         "le": "Kind",
         "t": "text"
        },
        {
         "k": "mode",
         "l": "模式",
         "le": "Mode",
         "t": "text"
        }
       ]
      },
      {
       "id": "resetlogo",
       "l": "重置 Logo",
       "le": "Reset logo",
       "ep": "adminResetLogo",
       "m": "POST"
      }
     ]
    }
   ]
  }
 ]
};

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
