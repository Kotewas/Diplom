package com.diplom.dispatcher.config;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

@Component
public class DatabaseSchemaMigration {

    private final JdbcTemplate jdbcTemplate;

    public DatabaseSchemaMigration(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    public void migrate() {
        addMeteorologistColumnsToFlights();
    }

    private void addMeteorologistColumnsToFlights() {
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_id varchar(255)");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_status varchar(255)");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_created_at timestamp(6) with time zone");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_text text");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_needs text");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_dispatcher_name varchar(255)");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_dispatcher_comment text");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_response_by_need text");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_message text");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_response_complete boolean");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_empty_fields_count integer");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_answered_at timestamp(6) with time zone");
        jdbcTemplate.execute("ALTER TABLE flights ADD COLUMN IF NOT EXISTS meteorologist_request_history text");
    }
}
