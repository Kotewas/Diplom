package com.diplom.dispatcher.flight;

import jakarta.validation.constraints.NotBlank;

public record ApplyDecisionRequest(
        @NotBlank String decision,
        @NotBlank String reason,
        Integer delayMinutes
) {
}
