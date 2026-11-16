"""scheduler_tick runs background identity checks once per owner, outside the global AI lock."""
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import pi_native, pi_worker as worker, pi_workspace as workspace, policy
from .pi_models import PiNativeState, PiOperation, PiSession, PiWorkspace
from .policy import AiError, mutation
from . import test_pi_workspace as fixtures


@override_settings(DJANGO_PROCESS_ROLE="development", DJANGO_ENVIRONMENT="test")
class SchedulerPrincipalTests(TestCase):
    setUp = fixtures.PiWorkspaceTests.setUp
    user = fixtures.PiWorkspaceTests.user
    session = fixtures.PiWorkspaceTests.session
    prompt = fixtures.PiWorkspaceTests.prompt
    call = fixtures.PiWorkspaceTests.call

    def idle_session(self, actor):
        """A root session whose first operation finished, so a follow-up can be launched."""
        self.prompt(actor=actor)
        operation = worker.claim()
        workspace._finish_init(operation)
        session = PiSession.objects.get(pk=operation.session_id)
        with mutation():
            PiWorkspace.objects.create(session=session, generation=session.generation, status="ready",
                model_id=self.model.id, model_version=self.model.version)
        return session.id

    def follow_up(self, session_id, message="next"):
        with mutation():
            session = PiSession.objects.get(pk=session_id)
            state = pi_native.state_for(session, lock=True)
            return pi_native._message(state, session, session, "follow_up", message)

    def tick(self, deny=()):
        """Run one tick; record every background check and whether it held the global lock."""
        real = policy.current_principal
        calls = []

        def checked(principal, **kwargs):
            if kwargs.get("background"):
                # TestCase wraps everything in one transaction, so the lock depth is the signal.
                calls.append((principal.email, policy._mutation_depth.get()))
                if principal.email in deny:
                    raise AiError("本地后台身份已失效", "access_denied", 403)
                kwargs = {**kwargs, "background": False}
            return real(principal, **kwargs)

        with patch.object(pi_native, "current_principal", side_effect=checked):
            pi_native.scheduler_tick()
        return calls

    def test_one_background_check_per_owner_and_outside_the_lock(self):
        ids = [self.idle_session(self.owner) for _ in range(3)]
        for session_id in ids:
            self.follow_up(session_id)
        before = PiOperation.objects.count()
        calls = self.tick()
        self.assertEqual(len(PiNativeState.objects.all()), 3)
        self.assertEqual(calls, [(self.owner.email, 0)])
        self.assertEqual(PiOperation.objects.count(), before + 3)

    def test_denied_owner_is_not_launched_and_others_are_unaffected(self):
        mine = self.idle_session(self.owner)
        theirs = self.idle_session(self.other)
        self.follow_up(mine)
        self.follow_up(theirs)
        before = PiOperation.objects.count()
        calls = self.tick(deny={self.owner.email})
        self.assertEqual(sorted(call[0] for call in calls), sorted([self.owner.email, self.other.email]))
        self.assertEqual(PiOperation.objects.filter(session_id=mine).count(), 1)
        self.assertEqual(PiOperation.objects.filter(session_id=theirs).count(), 2)
        self.assertEqual(PiOperation.objects.count(), before + 1)

    def test_identity_missing_from_precheck_is_skipped_without_error(self):
        session_id = self.idle_session(self.owner)
        self.follow_up(session_id)
        before = PiOperation.objects.count()
        with patch.object(pi_native, "_scheduler_precheck", return_value={}):
            pi_native.scheduler_tick()
        self.assertEqual(PiOperation.objects.count(), before)
        # The next tick, with a real precheck, launches it.
        self.tick()
        self.assertEqual(PiOperation.objects.count(), before + 1)
