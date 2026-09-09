from unittest.mock import patch
from django.test import SimpleTestCase
from types import SimpleNamespace
from . import dingtalk_transport as platform
from .policy import AiError


class DingTalkTransportTests(SimpleTestCase):
    config = {"profile": "corp:operator", "corpId": "corp", "unifiedAppId": "app", "robotCode": "bot",
              "robotName": "志高助手", "groups": [{"id": "group", "name": "测试群聊"}]}

    def response(self, args, profile):
        self.assertEqual(profile, "corp:operator")
        if args[:2] == ["profile", "list"]:
            return {"profiles": [{"profile": profile, "corpId": "corp", "status": "active"}]}
        if args[:3] == ["dev", "app", "list"]:
            return {"hasMore": False, "items": [{"robotName": "志高助手", "unifiedAppId": "app"}]}
        if args[:3] == ["dev", "app", "robot"]:
            return {"name": "志高助手", "robotCode": "bot", "mode": "STREAM", "configured": True, "robotStatus": "ONLINE"}
        if args[:2] == ["chat", "search"]:
            return {"result": {"hasMore": False, "groups": [{"title": "测试群聊", "openConversationId": "group"}]}}
        if args[:3] == ["chat", "group", "bots"]:
            return {"result": {"bots": [{"name": "志高助手", "robotCode": "bot", "status": 1}]}}
        if args[:3] == ["chat", "message", "send-by-bot"]:
            return {"ok": True}
        raise AssertionError(args)

    def test_group_trigger_replies_only_to_its_verified_sender(self):
        session = SimpleNamespace(sender_id="bound-staff", conversation_type="2", external_conversation_id="group")
        with patch.object(platform, "guard"), patch.object(platform, "dws", side_effect=self.response) as calls:
            platform.send(lambda: self.config, session, "有界结果")
        args = calls.call_args.args[0]
        self.assertNotIn("--group", args)
        self.assertEqual(args[args.index("--users")+1], "bound-staff")
        self.assertIn("send-by-bot", args)

    def test_removed_bot_stops_before_send(self):
        session = SimpleNamespace(sender_id="bound-staff", conversation_type="2", external_conversation_id="group")
        def response(args, profile):
            if args[:3] == ["chat", "group", "bots"]:
                return {"result": {"bots": []}}
            return self.response(args, profile)
        with patch.object(platform, "guard"), patch.object(platform, "dws", side_effect=response) as calls, self.assertRaises(AiError):
            platform.send(lambda: self.config, session, "结果")
        self.assertFalse(any(call.args[0][:3] == ["chat", "message", "send-by-bot"] for call in calls.call_args_list))

    def test_incomplete_app_search_fails_closed(self):
        def response(args, profile):
            result = self.response(args, profile)
            if args[:3] == ["dev", "app", "list"]:
                result["hasMore"] = True
            return result
        with patch.object(platform, "dws", side_effect=response), self.assertRaises(AiError):
            platform.robot(self.config)
