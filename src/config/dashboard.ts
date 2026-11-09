import type { DashboardConfig } from '@/types/dashboard';

const config: DashboardConfig = {
  "clientId": "a48bb3f00899e7a59f8d242432fb1867",
  "clientName": "The Gate : A Meeting Venue",
  "clientDomain": "thegategj.com",
  "clientEmail": "ljkurtz00@msn.com",
  "enabledWidgets": [
    "siteAnalytics",
    "contentEditors"
  ],
  "tutorialVideos": [],
  "links": [
    {
      "label": "Live Site",
      "url": "https://thegategj.com",
      "emoji": "🌐"
    },
    {
      "label": "Sanity Studio",
      "url": "https://studio.thegategj.com",
      "emoji": "✏️",
      "description": "Edit your content"
    }
  ],
  "contentEditors": [
    {
      "label": "Site Settings",
      "documentType": "siteSettings"
    }
  ],
  "billing": {
    "enabled": true,
    "showPendingCharges": true,
    "showOfflineInvoices": true
  },
  "submissionKinds": [
    {
      "kind": "contact",
      "one": "inquiry",
      "many": "inquiries",
      "match": "contact|sales|inquir|enquir|quote|message"
    },
    {
      "kind": "donation",
      "one": "gift",
      "many": "gifts",
      "match": "^donation"
    }
  ],
  "reports": {
    "reviewCadence": "monthly"
  },
  "analytics": {
    "provider": "simple-analytics",
    "simpleAnalyticsId": "thegategj.com",
    "scriptDomain": "sa.thegategj.com",
    "internalRoutes": [
      "/reports",
      "/analytics",
      "/billing",
      "/content-kit",
      "/support",
      "/help"
    ],
    "conversionPage": "/contact"
  },
  "contentKit": {
    "enabled": true,
    "sections": [
      {
        "id": "your_business",
        "label": "Your Business",
        "description": "Business name, tagline, industry, location, years in business",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_story",
        "label": "Your Story",
        "description": "Origin story, mission statement, values, team members",
        "enabled": true,
        "required": false
      },
      {
        "id": "your_customers",
        "label": "Your Customers",
        "description": "Testimonials, client logos, case studies",
        "enabled": true,
        "required": false
      },
      {
        "id": "practical_details",
        "label": "Practical Details",
        "description": "Phone, email, address, hours, social links",
        "enabled": true,
        "required": true
      },
      {
        "id": "your_goals",
        "label": "Your Goals",
        "description": "Primary website goal, secondary goals, target audience",
        "enabled": true,
        "required": false
      }
    ],
    "maxPersonalityPicks": 4,
    "welcomeMessage": "",
    "completionEmailNotify": true
  }
};

export default config;
