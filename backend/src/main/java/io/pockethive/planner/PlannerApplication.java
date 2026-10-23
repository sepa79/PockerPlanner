package io.pockethive.planner;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Responsibility: start the standalone Java Planner application.
 * Must not: select operational data, import plans or construct another identity owner.
 * Contract: docs/POCKET_FAMILY_UNIFICATION.md explicit isolated Java verification.
 */
@SpringBootApplication
public class PlannerApplication {
    public static void main(String[] arguments) {
        SpringApplication.run(PlannerApplication.class, arguments);
    }
}
