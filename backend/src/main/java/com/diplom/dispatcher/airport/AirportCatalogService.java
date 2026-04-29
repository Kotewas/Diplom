package com.diplom.dispatcher.airport;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class AirportCatalogService {

    private static final String AIRPORTS_RESOURCE_PATH = "airports-rf.json";
    private static final TypeReference<List<AirportDto>> AIRPORT_LIST = new TypeReference<>() {
    };
    private static final Pattern MULTI_SPACES = Pattern.compile("\\s+");
    private static final Pattern LATIN_OR_DIGITS = Pattern.compile("[A-Za-z0-9]");
    private static final List<String> CITY_BANNED_TOKENS = List.of(
            "лнг", "lng", "проиект", "project", "фиелд", "field", "гас", "gas"
    );
    private static final Map<String, String> CITY_FIXES = Map.ofEntries(
            Map.entry("Астрахан", "Астрахань"),
            Map.entry("Великии Устюг", "Великий Устюг"),
            Map.entry("Газимурскии Завод", "Газимурский Завод"),
            Map.entry("Далнии", "Дальний"),
            Map.entry("Депутацкии", "Депутатский"),
            Map.entry("Домбаровскии", "Домбаровский"),
            Map.entry("Завети Ил'ича", "Заветы Ильича"),
            Map.entry("Заполярнии", "Заполярный"),
            Map.entry("Каменск Уралскии", "Каменск-Уральский"),
            Map.entry("Кичменгскии Городок", "Кичменгский Городок"),
            Map.entry("Коз'модем'янск", "Козьмодемьянск"),
            Map.entry("Комсомолск-он-Амур", "Комсомольск-на-Амуре"),
            Map.entry("Коржевскии", "Коржевский"),
            Map.entry("Красни Адуи", "Красный Адуй"),
            Map.entry("Красни Восход", "Красный Восход"),
            Map.entry("Красни Кут", "Красный Кут"),
            Map.entry("Красни Яр", "Красный Яр"),
            Map.entry("Краснии Курган", "Красный Курган"),
            Map.entry("Краснии Чикои", "Красный Чикой"),
            Map.entry("Маикоп", "Майкоп"),
            Map.entry("Мис Каменнии", "Мыс Каменный"),
            Map.entry("Нижнии Новгород", "Нижний Новгород"),
            Map.entry("Новии Бор", "Новый Бор"),
            Map.entry("Озерновскии", "Озерновский"),
            Map.entry("Октябр'скии", "Октябрьский"),
            Map.entry("Октябрскии", "Октябрьский"),
            Map.entry("Петропавловск-Камчацкии", "Петропавловск-Камчатский"),
            Map.entry("Рибинск", "Рыбинск"),
            Map.entry("Ростов-он-Дон", "Ростов-на-Дону"),
            Map.entry("Ручии", "Ручьи"),
            Map.entry("Саранпаул'", "Саранпауль"),
            Map.entry("Сиктивкар", "Сыктывкар"),
            Map.entry("Совецкая Гаван", "Советская Гавань"),
            Map.entry("Совецкии", "Советский"),
            Map.entry("Ст. Петерсбург", "Санкт-Петербург"),
            Map.entry("Ставропол", "Ставрополь"),
            Map.entry("Твер", "Тверь"),
            Map.entry("Тюмен", "Тюмень"),
            Map.entry("Улан Уде", "Улан-Удэ"),
            Map.entry("Уляновск", "Ульяновск"),
            Map.entry("Уст'-Бол'шерецк", "Усть-Большерецк"),
            Map.entry("Уст'-Кара", "Усть-Кара"),
            Map.entry("Уст'-Стрелка", "Усть-Стрелка"),
            Map.entry("Чернии Яр", "Черный Яр"),
            Map.entry("Черскии", "Черский"),
            Map.entry("Ярославл", "Ярославль"),
            Map.entry("Александровск-Сахалинскии", "Александровск-Сахалинский")
    );

    private static final List<AirportDto> TVER_HELIPORTS = List.of(
            new AirportDto("TVR_HELI", "Змеево", "Тверь", 56.8591, 35.7577, "tver"),
            new AirportDto("TOR_HELI", "Торжок", "Торжок", 57.0397, 34.9628, "tver"),
            new AirportDto("RZH_HELI", "Ржев", "Ржев", 56.2620, 34.3291, "tver"),
            new AirportDto("KON_HELI", "Конаково", "Конаково", 56.7055, 36.7696, "tver"),
            new AirportDto("KSH_HELI", "Кашин", "Кашин", 57.3588, 37.6133, "tver"),
            new AirportDto("BTK_HELI", "Бежецк", "Бежецк", 57.7860, 36.6900, "tver"),
            new AirportDto("BLG_HELI", "Бологое", "Бологое", 57.8850, 34.0530, "tver"),
            new AirportDto("VVW_HELI", "Вышний Волочек", "Вышний Волочек", 57.5910, 34.5640, "tver"),
            new AirportDto("KMR_HELI", "Кимры", "Кимры", 56.8730, 37.3550, "tver"),
            new AirportDto("KLZ_HELI", "Калязин", "Калязин", 57.2410, 37.8520, "tver"),
            new AirportDto("OST_HELI", "Осташков", "Осташков", 57.1460, 33.1030, "tver"),
            new AirportDto("NLD_HELI", "Нелидово", "Нелидово", 56.2230, 32.7770, "tver"),
            new AirportDto("UDM_HELI", "Удомля", "Удомля", 57.8790, 35.0050, "tver"),
            new AirportDto("TRP_HELI", "Торопец", "Торопец", 56.4970, 31.6350, "tver"),
            new AirportDto("STR_HELI", "Старица", "Старица", 56.5140, 34.9390, "tver"),
            new AirportDto("LKH_HELI", "Лихославль", "Лихославль", 57.1260, 35.4660, "tver"),
            new AirportDto("VSG_HELI", "Весьегонск", "Весьегонск", 58.6580, 37.2630, "tver"),
            new AirportDto("ZDV_HELI", "Западная Двина", "Западная Двина", 56.2560, 32.0740, "tver"),
            new AirportDto("ANP_HELI", "Андреаполь", "Андреаполь", 56.6510, 32.2660, "tver"),
            new AirportDto("KVN_HELI", "Кувшиново", "Кувшиново", 57.0260, 34.1680, "tver"),
            new AirportDto("KRH_HELI", "Красный Холм", "Красный Холм", 58.0570, 37.1200, "tver"),
            new AirportDto("MKS_HELI", "Максатиха", "Максатиха", 57.8010, 35.8820, "tver"),
            new AirportDto("SLZ_HELI", "Селижарово", "Селижарово", 56.8520, 33.4480, "tver"),
            new AirportDto("SPR_HELI", "Спирово", "Спирово", 57.4180, 34.9810, "tver"),
            new AirportDto("SNK_HELI", "Сонково", "Сонково", 57.7800, 37.1620, "tver"),
            new AirportDto("SND_HELI", "Сандово", "Сандово", 58.4600, 37.3110, "tver"),
            new AirportDto("BLY_HELI", "Белый", "Белый", 55.8400, 32.9390, "tver"),
            new AirportDto("ZBC_HELI", "Зубцов", "Зубцов", 56.1760, 34.5880, "tver")
    );

    private final List<AirportDto> airports;
    private final Map<String, AirportDto> byId;

    public AirportCatalogService(ObjectMapper objectMapper) {
        List<AirportDto> loadedRussianAirports = loadRussianAirports(objectMapper);
        List<AirportDto> merged = Stream.concat(loadedRussianAirports.stream(), TVER_HELIPORTS.stream())
                .collect(Collectors.collectingAndThen(
                        Collectors.toMap(AirportDto::id, Function.identity(), (left, right) -> left),
                        map -> map.values().stream()
                                .sorted(Comparator.comparing(AirportDto::city).thenComparing(AirportDto::id))
                                .toList()
                ));

        this.airports = List.copyOf(merged);
        this.byId = this.airports.stream()
                .collect(Collectors.toUnmodifiableMap(AirportDto::id, Function.identity()));
    }

    public List<AirportDto> getAll() {
        return airports;
    }

    public Optional<AirportDto> getById(String airportId) {
        return Optional.ofNullable(byId.get(airportId));
    }

    private List<AirportDto> loadRussianAirports(ObjectMapper objectMapper) {
        try {
            ClassPathResource resource = new ClassPathResource(AIRPORTS_RESOURCE_PATH);
            if (!resource.exists()) {
                return new ArrayList<>();
            }

            try (InputStream inputStream = resource.getInputStream()) {
                List<AirportDto> parsed = objectMapper.readValue(inputStream, AIRPORT_LIST);
                if (parsed == null) {
                    return new ArrayList<>();
                }
                return parsed.stream()
                        .map(this::normalizeAirport)
                        .filter(item -> item != null)
                        .toList();
            }
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private AirportDto normalizeAirport(AirportDto source) {
        if (source == null) {
            return null;
        }

        String id = normalizeText(source.id());
        String name = normalizeText(source.name());
        String city = normalizeCity(source.city());

        if (id == null || name == null || city == null) {
            return null;
        }
        if ("Аэропорт".equalsIgnoreCase(name)) {
            return null;
        }

        return new AirportDto(id, name, city, source.lat(), source.lon(), source.region());
    }

    private String normalizeCity(String rawCity) {
        String city = normalizeText(rawCity);
        if (city == null) {
            return null;
        }

        if ("Не указано".equalsIgnoreCase(city)) {
            return null;
        }

        String lowered = city.toLowerCase();
        if (CITY_BANNED_TOKENS.stream().anyMatch(lowered::contains)) {
            return null;
        }

        city = CITY_FIXES.getOrDefault(city, city);
        city = city.replace("-он-", "-на-");
        city = city.replace("  ", " ").trim();

        if (LATIN_OR_DIGITS.matcher(city).find()) {
            return null;
        }

        return city;
    }

    private String normalizeText(String value) {
        if (value == null) {
            return null;
        }
        String normalized = MULTI_SPACES.matcher(value.trim()).replaceAll(" ");
        return normalized.isBlank() ? null : normalized;
    }
}
