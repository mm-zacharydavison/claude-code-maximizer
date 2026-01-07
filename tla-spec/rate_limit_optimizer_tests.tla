---------------------------- MODULE rate_limit_optimizer_tests ----------------------------
EXTENDS rate_limit_optimizer, TLC, Integers, Sequences

(*
 * TEST CONFIGURATION AND SCENARIOS
 * 
 * This module defines test cases for verifying the rate limit optimizer.
 * Tests cover both unknown usage (bootstrap) and known usage (steady state).
 *)

=============================================================================
(* TEST CONFIGURATIONS *)
=============================================================================

(*
 * Configuration 1: Standard workday
 * - 5 hour windows
 * - 07:30-16:00 workday
 * - Quota of 100 units
 *)
CONSTANT_CONFIG_STANDARD ==
    /\ QUOTA = 100
    /\ WINDOW_SIZE = 300        \* 5 hours in minutes
    /\ WORK_START = 450         \* 07:30
    /\ WORK_END = 960           \* 16:00
    /\ CALIBRATION_DAYS = 7
    /\ TIME_GRANULARITY = 15
    /\ MAX_TIME = 14400         \* 10 days in minutes

(*
 * Configuration 2: Short workday (edge case)
 * - Less than one full window
 *)
CONSTANT_CONFIG_SHORT_DAY ==
    /\ QUOTA = 100
    /\ WINDOW_SIZE = 300
    /\ WORK_START = 540         \* 09:00
    /\ WORK_END = 720           \* 12:00 (only 3 hours)
    /\ CALIBRATION_DAYS = 7
    /\ TIME_GRANULARITY = 15
    /\ MAX_TIME = 14400

(*
 * Configuration 3: Long workday
 * - More than two full windows possible
 *)
CONSTANT_CONFIG_LONG_DAY ==
    /\ QUOTA = 100
    /\ WINDOW_SIZE = 300
    /\ WORK_START = 360         \* 06:00
    /\ WORK_END = 1080          \* 18:00 (12 hours)
    /\ CALIBRATION_DAYS = 7
    /\ TIME_GRANULARITY = 15
    /\ MAX_TIME = 14400

=============================================================================
(* TEST CASE 1: UNKNOWN USAGE - BOOTSTRAP PHASE *)
=============================================================================

\* TC1.1: Initial state should be bootstrap phase
Test_InitialPhaseIsBootstrap ==
    Init => phase = "bootstrap"

\* TC1.2: Default trigger should be conservative (before work start)
Test_DefaultTriggerIsConservative ==
    Init => trigger_time < WORK_START

\* TC1.3: Usage log should start empty
Test_EmptyUsageLog ==
    Init => DOMAIN usage_log = {}

\* TC1.4: Should use default profile during bootstrap
Test_DefaultProfileDuringBootstrap ==
    phase = "bootstrap" => usage_profile = DefaultProfile

\* TC1.5: Should transition to calibrate after CALIBRATION_DAYS
Test_TransitionToCalibrate ==
    (phase = "bootstrap" /\ day_count = CALIBRATION_DAYS - 1) ~>
    (phase = "calibrate" \/ phase = "steady_state")

\* TC1.6: Usage should be logged during bootstrap
Test_UsageLoggedDuringBootstrap ==
    LET before_size == Cardinality(DOMAIN usage_log)
    IN  (phase = "bootstrap" /\ UseQuota) => 
        Cardinality(DOMAIN usage_log') >= before_size

\* TC1.7: Bootstrap should allow full quota usage without wait
Test_BootstrapNoWait ==
    (phase = "bootstrap" /\ day_count < CALIBRATION_DAYS) =>
    (current_window.usage_consumed <= QUOTA)

=============================================================================
(* TEST CASE 2: UNKNOWN USAGE - UNIFORM DISTRIBUTION ASSUMPTION *)
=============================================================================

\* TC2.1: With unknown usage, assume uniform distribution
Test_UnknownUsageUniformProfile ==
    LET uniform_rate == QUOTA \div 10  \* Spread across ~10 work hours
    IN  phase = "bootstrap" => 
        \A h \in 0..23 : usage_profile[h] = uniform_rate

\* TC2.2: Default profile should not exceed quota in any window
Test_DefaultProfileSafe ==
    \A trig \in 0..WORK_START :
        \A w \in WindowsForTrigger(trig) :
            ExpectedWindowUsage(DefaultProfile, w) <= QUOTA

\* TC2.3: Conservative trigger should provide buffer
Test_ConservativeTriggerBuffer ==
    Init => 
        LET windows == WindowsForTrigger(trigger_time)
            first_window == CHOOSE w \in windows : 
                            \A other \in windows : w.start <= other.start
        IN  first_window.work_overlap_end - first_window.work_overlap_start >= 120

=============================================================================
(* TEST CASE 3: KNOWN USAGE - PROFILE-BASED OPTIMIZATION *)
=============================================================================

\* TC3.1: Profile should be computed from usage log
Test_ProfileFromLog ==
    phase = "calibrate" => 
        usage_profile' = BuildProfile(usage_log)

\* TC3.2: Optimal trigger should maximize bucket count
Test_MaximizeBucketCount ==
    phase = "steady_state" =>
        \A other_trig \in 0..WORK_START :
            IsValidTrigger(usage_profile, other_trig) =>
            Cardinality(WindowsForTrigger(trigger_time)) >= 
            Cardinality(WindowsForTrigger(other_trig))

\* TC3.3: Optimal trigger should be valid (no overruns)
Test_TriggerIsValid ==
    phase = "steady_state" =>
        IsValidTrigger(usage_profile, trigger_time)

\* TC3.4: Among equal bucket counts, maximize minimum slack
Test_MaximizeMinSlack ==
    phase = "steady_state" =>
        \A other_trig \in 0..WORK_START :
            (/\ IsValidTrigger(usage_profile, other_trig)
             /\ Cardinality(WindowsForTrigger(trigger_time)) = 
                Cardinality(WindowsForTrigger(other_trig)))
            => MinSlack(usage_profile, trigger_time) >= 
               MinSlack(usage_profile, other_trig)

\* TC3.5: Trigger should be recalculated if profile changes significantly
Test_TriggerUpdatesWithProfile ==
    (phase = "steady_state" /\ usage_profile' /= usage_profile) =>
        trigger_time' = FindOptimalTrigger(usage_profile')

=============================================================================
(* TEST CASE 4: SPECIFIC USAGE PATTERNS *)
=============================================================================

\* TC4.1: Heavy morning usage pattern
\* Expected: Trigger should create longer first window overlap
MockProfileHeavyMorning == 
    [h \in 0..23 |-> 
        CASE h \in 7..9   -> 30   \* Heavy: 90 total in 3 hours
          [] h \in 10..12 -> 10   \* Light: 30 total
          [] h \in 13..15 -> 15   \* Medium: 45 total  
          [] OTHER        -> 0]

Test_HeavyMorningOptimalTrigger ==
    LET profile == MockProfileHeavyMorning
        optimal == FindOptimalTrigger(profile)
        windows == WindowsForTrigger(optimal)
        morning_window == CHOOSE w \in windows :
                          w.work_overlap_start < 600  \* Before 10:00
    IN  \* Morning window should have enough time for heavy usage
        morning_window.work_overlap_end - morning_window.work_overlap_start >= 150

\* TC4.2: Heavy afternoon usage pattern  
\* Expected: Final window should have adequate overlap
MockProfileHeavyAfternoon ==
    [h \in 0..23 |->
        CASE h \in 7..9   -> 10   \* Light morning
          [] h \in 10..12 -> 10   \* Light midday
          [] h \in 13..15 -> 35   \* Heavy afternoon: 105 total (exceeds!)
          [] OTHER        -> 0]

Test_HeavyAfternoonMustSplit ==
    LET profile == MockProfileHeavyAfternoon
        optimal == FindOptimalTrigger(profile)
        windows == WindowsForTrigger(optimal)
    IN  \* Must have reset during afternoon to avoid overrun
        \E w \in windows : 
            /\ w.start >= 780      \* After 13:00
            /\ w.start < 900       \* Before 15:00

\* TC4.3: Uniform usage pattern
\* Expected: Any valid trigger with max buckets is acceptable  
MockProfileUniform ==
    [h \in 0..23 |->
        IF h \in 7..15 THEN 10 ELSE 0]  \* 80 total across 8 hours

Test_UniformUsageMultipleTriggers ==
    LET profile == MockProfileUniform
        optimal == FindOptimalTrigger(profile)
    IN  IsValidTrigger(profile, optimal)

\* TC4.4: Spiky usage pattern (should still be valid)
MockProfileSpiky ==
    [h \in 0..23 |->
        CASE h = 8  -> 40    \* Big spike at 08:00
          [] h = 12 -> 40    \* Big spike at 12:00
          [] h = 15 -> 40    \* Big spike at 15:00 (but after work in some configs)
          [] OTHER  -> 5]

Test_SpikyUsageHandled ==
    LET profile == MockProfileSpiky
        optimal == FindOptimalTrigger(profile)
    IN  \* Either valid, or falls back to safe default
        \/ IsValidTrigger(profile, optimal)
        \/ optimal = WORK_START

=============================================================================
(* TEST CASE 5: EDGE CASES *)
=============================================================================

\* TC5.1: Zero usage day should not break profile
Test_ZeroUsageDay ==
    (day_count > 0 /\ usage_log = [x \in {} |-> 0]) =>
        BuildProfile(usage_log) = [h \in 0..23 |-> 0]

\* TC5.2: Single window fits entire workday
Test_SingleWindowWorkday ==
    (WORK_END - WORK_START <= WINDOW_SIZE) =>
        Cardinality(WindowsForTrigger(WORK_START)) = 1

\* TC5.3: Window boundary exactly at work start
Test_WindowBoundaryAtWorkStart ==
    LET trig == WORK_START - WINDOW_SIZE  \* Reset exactly at work start
        windows == WindowsForTrigger(trig)
    IN  Cardinality(windows) >= 1

\* TC5.4: Window boundary exactly at work end
Test_WindowBoundaryAtWorkEnd ==
    LET trig == WORK_END - WINDOW_SIZE  \* Reset exactly at work end
        windows == WindowsForTrigger(trig)
    IN  \E w \in windows : w.work_overlap_end = WORK_END

\* TC5.5: Very high usage should force 2-bucket fallback
MockProfileExcessive ==
    [h \in 0..23 |->
        IF h \in 7..15 THEN 50 ELSE 0]  \* 400 total - way over any valid config

Test_ExcessiveUsageFallback ==
    LET profile == MockProfileExcessive
        optimal == FindOptimalTrigger(profile)
    IN  \* Should fall back to naive trigger when no valid option
        optimal = WORK_START

\* TC5.6: Exactly quota usage should be valid (boundary)
MockProfileExactQuota ==
    [h \in 0..23 |->
        CASE h \in 7..9   -> 33   \* 99 in first potential window
          [] h \in 10..14 -> 20   \* 100 in second window  
          [] h = 15       -> 1    \* Tiny remainder
          [] OTHER        -> 0]

Test_ExactQuotaBoundary ==
    LET profile == MockProfileExactQuota
    IN  \E trig \in 0..WORK_START : IsValidTrigger(profile, trig)

=============================================================================
(* TEST CASE 6: TEMPORAL PROPERTIES *)
=============================================================================

\* TC6.1: System always eventually reaches steady state
Test_EventualSteadyState ==
    <>(phase = "steady_state")

\* TC6.2: Once in steady state, should stay there
Test_SteadyStateStable ==
    [](phase = "steady_state" => [](phase = "steady_state"))

\* TC6.3: Wait events should be minimized in steady state
Test_MinimalWaitsInSteadyState ==
    (phase = "steady_state") => 
        (wait_events' <= wait_events + 1)  \* At most one wait per transition

\* TC6.4: Total usage should increase during work hours
Test_UsageIncreasesDuringWork ==
    (IsWorkTime(TimeOfDay(clock)) /\ phase = "steady_state") ~>
    (total_usage' > total_usage)

=============================================================================
(* TEST CASE 7: RECALIBRATION *)
=============================================================================

\* TC7.1: Profile should update with new data
Test_ProfileUpdatesWeekly ==
    (phase = "steady_state" /\ day_count % 7 = 0) =>
        usage_profile' = BuildProfile(usage_log)

\* TC7.2: Trigger should be recalculated on profile update
Test_TriggerRecalculatedOnUpdate ==
    (phase = "steady_state" /\ usage_profile' /= usage_profile) =>
        trigger_time' = FindOptimalTrigger(usage_profile')

\* TC7.3: Recalibration should not cause wait violations
Test_RecalibrationNoViolation ==
    (phase = "steady_state" /\ usage_profile' /= usage_profile) =>
        IsValidTrigger(usage_profile', trigger_time')

=============================================================================
(* MODEL CHECKING CONFIGURATION *)
=============================================================================

\* State constraint to bound model checking
StateConstraint ==
    /\ clock <= MAX_TIME
    /\ day_count <= CALIBRATION_DAYS + 3
    /\ total_usage <= QUOTA * 50
    /\ wait_events <= 10
    /\ wasted_quota <= QUOTA * 20

\* Symmetry reduction (if applicable)
Symmetry == {}

\* Properties to check
PropertiesToCheck ==
    /\ TypeInvariant
    /\ NoWaitViolation
    /\ WindowIntegrity
    /\ TriggerOptimalAfterCalibration
    /\ MaximizeBuckets

=============================================================================
